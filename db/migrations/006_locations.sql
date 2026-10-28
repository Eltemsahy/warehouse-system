-- P1-3 locations module (Schema doc locations section, ADR 0004).
-- Warehouse codes, location type codes and storage class codes are unique organisation-wide;
-- zone and location codes are unique per warehouse. All comparisons ignore case, so "a-01"
-- and "A-01" cannot both exist in one warehouse. Codes never change and a zone or location
-- never moves between warehouses (triggers below). Audit columns follow the global
-- conventions; created_by and updated_by stay null until the identity module exists.
CREATE SCHEMA IF NOT EXISTS locations;

CREATE TABLE locations.warehouse (
  id          uuid        PRIMARY KEY,
  code        text        NOT NULL,
  name        text        NOT NULL,
  address     text,
  timezone    text        NOT NULL DEFAULT 'UTC',
  status      text        NOT NULL DEFAULT 'ACTIVE',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT warehouse_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$'),
  CONSTRAINT warehouse_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE'))
);
CREATE UNIQUE INDEX warehouse_code_key ON locations.warehouse (lower(code));

CREATE TABLE locations.zone (
  id            uuid        PRIMARY KEY,
  warehouse_id  uuid        NOT NULL REFERENCES locations.warehouse (id),
  code          text        NOT NULL,
  type          text        NOT NULL,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_by    uuid,
  version       integer     NOT NULL DEFAULT 1,
  CONSTRAINT zone_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$'),
  CONSTRAINT zone_type_chk CHECK (
    type IN ('RECEIVING', 'STORAGE', 'PICKING', 'PACKING', 'SHIPPING', 'QUARANTINE')
  ),
  -- Lets a location prove its zone belongs to the same warehouse (composite foreign key).
  CONSTRAINT zone_id_warehouse_key UNIQUE (id, warehouse_id)
);
CREATE UNIQUE INDEX zone_warehouse_code_key ON locations.zone (warehouse_id, lower(code));

CREATE TABLE locations.location_type (
  id           uuid        PRIMARY KEY,
  code         text        NOT NULL,
  name         text        NOT NULL,
  is_pickable  boolean     NOT NULL DEFAULT false,
  is_storable  boolean     NOT NULL DEFAULT false,
  is_staging   boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  version      integer     NOT NULL DEFAULT 1,
  CONSTRAINT location_type_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$')
);
CREATE UNIQUE INDEX location_type_code_key ON locations.location_type (lower(code));

CREATE TABLE locations.storage_class (
  id          uuid        PRIMARY KEY,
  code        text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT storage_class_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$')
);
CREATE UNIQUE INDEX storage_class_code_key ON locations.storage_class (lower(code));

CREATE TABLE locations.location (
  id                uuid        PRIMARY KEY,
  warehouse_id      uuid        NOT NULL REFERENCES locations.warehouse (id),
  zone_id           uuid,
  location_type_id  uuid        NOT NULL REFERENCES locations.location_type (id),
  code              text        NOT NULL,
  aisle             text,
  bay               text,
  level             text,
  position          text,
  status            text        NOT NULL DEFAULT 'AVAILABLE',
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_by        uuid,
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT location_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$'),
  CONSTRAINT location_status_chk CHECK (status IN ('AVAILABLE', 'BLOCKED')),
  CONSTRAINT location_aisle_len CHECK (char_length(aisle) BETWEEN 1 AND 32),
  CONSTRAINT location_bay_len CHECK (char_length(bay) BETWEEN 1 AND 32),
  CONSTRAINT location_level_len CHECK (char_length(level) BETWEEN 1 AND 32),
  CONSTRAINT location_position_len CHECK (char_length(position) BETWEEN 1 AND 32),
  -- The zone must belong to the same warehouse. A null zone_id skips the check.
  CONSTRAINT location_zone_same_warehouse
    FOREIGN KEY (zone_id, warehouse_id) REFERENCES locations.zone (id, warehouse_id)
);
CREATE UNIQUE INDEX location_warehouse_code_key ON locations.location (warehouse_id, lower(code));
CREATE INDEX location_zone_idx ON locations.location (warehouse_id, zone_id);

CREATE TABLE locations.location_capacity (
  location_id  uuid          PRIMARY KEY REFERENCES locations.location (id),
  max_units    integer,
  max_weight   numeric(12,3),
  max_volume   numeric(12,3),
  max_lpns     integer,
  CONSTRAINT location_capacity_units_chk CHECK (max_units >= 0),
  CONSTRAINT location_capacity_weight_chk CHECK (max_weight >= 0),
  CONSTRAINT location_capacity_volume_chk CHECK (max_volume >= 0),
  CONSTRAINT location_capacity_lpns_chk CHECK (max_lpns >= 0)
);

CREATE TABLE locations.location_storage_class (
  location_id       uuid NOT NULL REFERENCES locations.location (id),
  storage_class_id  uuid NOT NULL REFERENCES locations.storage_class (id),
  PRIMARY KEY (location_id, storage_class_id)
);

-- ADR 0004: codes are immutable (the ledger is append-only, so a rename would mean rewriting
-- history), and a zone or location never moves to another warehouse.
CREATE FUNCTION locations.forbid_code_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION '% codes are immutable (ADR 0004)', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION locations.forbid_warehouse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id THEN
    RAISE EXCEPTION '% rows cannot move to another warehouse (ADR 0004)', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER warehouse_code_immutable BEFORE UPDATE ON locations.warehouse
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_code_change();
CREATE TRIGGER zone_code_immutable BEFORE UPDATE ON locations.zone
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_code_change();
CREATE TRIGGER location_code_immutable BEFORE UPDATE ON locations.location
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_code_change();
CREATE TRIGGER location_type_code_immutable BEFORE UPDATE ON locations.location_type
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_code_change();
CREATE TRIGGER storage_class_code_immutable BEFORE UPDATE ON locations.storage_class
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_code_change();
CREATE TRIGGER zone_warehouse_immutable BEFORE UPDATE ON locations.zone
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_warehouse_change();
CREATE TRIGGER location_warehouse_immutable BEFORE UPDATE ON locations.location
  FOR EACH ROW EXECUTE FUNCTION locations.forbid_warehouse_change();

-- Reference data the module expects to find (the in-memory repository seeds the same values).
INSERT INTO locations.location_type (id, code, name, is_pickable, is_storable, is_staging) VALUES
  (gen_random_uuid(), 'BIN',     'Shelf or rack bin',  true,  true,  false),
  (gen_random_uuid(), 'PALLET',  'Pallet position',    false, true,  false),
  (gen_random_uuid(), 'FLOOR',   'Bulk floor storage', false, true,  false),
  (gen_random_uuid(), 'STAGING', 'Staging area',       false, false, true);

INSERT INTO locations.storage_class (id, code, name) VALUES
  (gen_random_uuid(), 'AMBIENT', 'Ambient'),
  (gen_random_uuid(), 'COLD',    'Cold'),
  (gen_random_uuid(), 'FROZEN',  'Frozen'),
  (gen_random_uuid(), 'HAZMAT',  'Hazardous materials');