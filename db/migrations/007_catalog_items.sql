-- P1-4 step 1: units of measure, categories, items and per-item units (Schema doc, catalog).
-- ADR 0004: a SKU is a case-insensitively unique business code, 1 to 64 characters, and never
-- changes (the ledger is append-only). An item's base unit never changes either, because
-- every stock quantity is a whole number of that unit. Audit columns and the optimistic-lock
-- version follow the global conventions; created_by and updated_by stay null until identity.
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.uom (
  id          uuid        PRIMARY KEY,
  code        text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT uom_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$')
);
CREATE UNIQUE INDEX uom_code_key ON catalog.uom (lower(code));

CREATE TABLE catalog.item_category (
  id          uuid        PRIMARY KEY,
  parent_id   uuid        REFERENCES catalog.item_category (id),
  code        text        NOT NULL,
  name        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,
  version     integer     NOT NULL DEFAULT 1,
  CONSTRAINT item_category_code_format CHECK (code ~ '^[A-Za-z0-9._/-]{1,64}$')
);
CREATE UNIQUE INDEX item_category_code_key ON catalog.item_category (lower(code));

CREATE TABLE catalog.item (
  id                 uuid        PRIMARY KEY,
  sku                text        NOT NULL,
  description        text        NOT NULL,
  category_id        uuid        REFERENCES catalog.item_category (id),
  base_uom_id        uuid        NOT NULL REFERENCES catalog.uom (id),
  status             text        NOT NULL DEFAULT 'ACTIVE',
  is_lot_tracked     boolean     NOT NULL DEFAULT false,
  is_serial_tracked  boolean     NOT NULL DEFAULT false,
  has_expiry         boolean     NOT NULL DEFAULT false,
  shelf_life_days    integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_by         uuid,
  version            integer     NOT NULL DEFAULT 1,
  CONSTRAINT item_sku_format CHECK (sku ~ '^[A-Za-z0-9._/-]{1,64}$'),
  CONSTRAINT item_status_chk CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT item_description_len CHECK (char_length(description) BETWEEN 1 AND 500),
  CONSTRAINT item_shelf_life_chk CHECK (shelf_life_days IS NULL OR (has_expiry AND shelf_life_days > 0))
);
CREATE UNIQUE INDEX item_sku_key ON catalog.item (lower(sku));
CREATE INDEX item_category_idx ON catalog.item (category_id);

CREATE TABLE catalog.item_uom (
  id           uuid          PRIMARY KEY,
  item_id      uuid          NOT NULL REFERENCES catalog.item (id),
  uom_id       uuid          NOT NULL REFERENCES catalog.uom (id),
  qty_in_base  integer       NOT NULL,
  length       numeric(12,3),
  width        numeric(12,3),
  height       numeric(12,3),
  weight       numeric(12,3),
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_by   uuid,
  version      integer       NOT NULL DEFAULT 1,
  CONSTRAINT item_uom_qty_chk CHECK (qty_in_base >= 1),
  CONSTRAINT item_uom_dimensions_chk CHECK (
    length >= 0 AND width >= 0 AND height >= 0 AND weight >= 0
  ),
  CONSTRAINT item_uom_item_uom_key UNIQUE (item_id, uom_id)
);

-- Identity never changes: codes, SKUs, an item's base unit, and which item/unit a row is for.
CREATE FUNCTION catalog.forbid_code_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION '% codes are immutable (ADR 0004)', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION catalog.forbid_item_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sku IS DISTINCT FROM OLD.sku THEN
    RAISE EXCEPTION 'a SKU is immutable (ADR 0004)' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.base_uom_id IS DISTINCT FROM OLD.base_uom_id THEN
    RAISE EXCEPTION 'an item''s base unit of measure is immutable (stock is counted in it)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION catalog.forbid_item_uom_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    RAISE EXCEPTION 'an item unit cannot be moved to another item or unit of measure'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER uom_code_immutable BEFORE UPDATE ON catalog.uom
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_code_change();
CREATE TRIGGER item_category_code_immutable BEFORE UPDATE ON catalog.item_category
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_code_change();
CREATE TRIGGER item_identity_immutable BEFORE UPDATE ON catalog.item
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_item_identity_change();
CREATE TRIGGER item_uom_identity_immutable BEFORE UPDATE ON catalog.item_uom
  FOR EACH ROW EXECUTE FUNCTION catalog.forbid_item_uom_identity_change();

-- Units of measure the module expects (the in-memory repository seeds the same values).
INSERT INTO catalog.uom (id, code, name) VALUES
  (gen_random_uuid(), 'EA', 'Each'),
  (gen_random_uuid(), 'CS', 'Case'),
  (gen_random_uuid(), 'PL', 'Pallet');