-- Roles, permissions and warehouse access (ADR 0005).
-- Permissions and system roles are seeded here. A later migration that adds a permission must
-- also grant it to the roles that need it (ADMIN included), alongside the code that checks it.

CREATE TABLE IF NOT EXISTS identity.permission (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code     text NOT NULL,
  resource text NOT NULL,
  action   text NOT NULL,
  CONSTRAINT permission_code_key UNIQUE (code),
  CONSTRAINT permission_code_format CHECK (code ~ '^[a-z]+(\.[a-z]+)+$')
);

CREATE TABLE IF NOT EXISTS identity.role (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text    NOT NULL,
  name           text    NOT NULL,
  description    text    NOT NULL,
  is_system      boolean NOT NULL DEFAULT false,
  -- Holders of the role can act in every warehouse, including future ones.
  all_warehouses boolean NOT NULL DEFAULT false,
  CONSTRAINT role_code_key UNIQUE (code),
  CONSTRAINT role_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$')
);

CREATE TABLE IF NOT EXISTS identity.role_permission (
  role_id       uuid NOT NULL REFERENCES identity.role (id),
  permission_id uuid NOT NULL REFERENCES identity.permission (id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS identity.user_role (
  user_id     uuid NOT NULL REFERENCES identity.user_account (id),
  role_id     uuid NOT NULL REFERENCES identity.role (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid REFERENCES identity.user_account (id),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS user_role_role_idx ON identity.user_role (role_id);

-- warehouse_id is a soft reference to locations.warehouse: no foreign key across schemas.
CREATE TABLE IF NOT EXISTS identity.user_warehouse_access (
  user_id      uuid NOT NULL REFERENCES identity.user_account (id),
  warehouse_id uuid NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  granted_by   uuid REFERENCES identity.user_account (id),
  PRIMARY KEY (user_id, warehouse_id)
);

INSERT INTO identity.permission (code, resource, action) VALUES
  ('identity.users.read',   'identity.users',  'read'),
  ('identity.users.manage', 'identity.users',  'manage'),
  ('identity.access.manage','identity.access', 'manage'),
  ('locations.read',        'locations',       'read'),
  ('locations.manage',      'locations',       'manage'),
  ('catalog.read',          'catalog',         'read'),
  ('catalog.manage',        'catalog',         'manage'),
  ('inventory.read',        'inventory',       'read'),
  ('inventory.adjust',      'inventory',       'adjust'),
  ('inventory.transfer',    'inventory',       'transfer')
ON CONFLICT (code) DO NOTHING;

INSERT INTO identity.role (code, name, description, is_system, all_warehouses) VALUES
  ('ADMIN',                'System administrator',  'Manages users, access, master data and everything else, in every warehouse.', true, true),
  ('WAREHOUSE_MANAGER',    'Warehouse manager',     'Runs a warehouse: master data, stock changes and monitoring.',                true, false),
  ('INVENTORY_CONTROLLER', 'Inventory controller',  'Adjusts and transfers stock.',                                                true, false),
  ('RECEIVER',             'Receiver',              'Checks in received goods.',                                                   true, false),
  ('PUTAWAY_OPERATOR',     'Putaway operator',      'Moves received goods to storage locations.',                                  true, false),
  ('PICKER',               'Picker',                'Picks orders from storage locations.',                                        true, false),
  ('PACKER',               'Packer / shipping clerk','Verifies, packs and ships orders.',                                          true, false)
ON CONFLICT (code) DO NOTHING;

-- ADMIN holds every permission that exists now.
INSERT INTO identity.role_permission (role_id, permission_id)
SELECT r.id, p.id FROM identity.role r CROSS JOIN identity.permission p WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO identity.role_permission (role_id, permission_id)
SELECT r.id, p.id
  FROM (VALUES
    ('WAREHOUSE_MANAGER',    'identity.users.read'),
    ('WAREHOUSE_MANAGER',    'locations.read'),
    ('WAREHOUSE_MANAGER',    'locations.manage'),
    ('WAREHOUSE_MANAGER',    'catalog.read'),
    ('WAREHOUSE_MANAGER',    'inventory.read'),
    ('WAREHOUSE_MANAGER',    'inventory.adjust'),
    ('WAREHOUSE_MANAGER',    'inventory.transfer'),
    ('INVENTORY_CONTROLLER', 'locations.read'),
    ('INVENTORY_CONTROLLER', 'catalog.read'),
    ('INVENTORY_CONTROLLER', 'inventory.read'),
    ('INVENTORY_CONTROLLER', 'inventory.adjust'),
    ('INVENTORY_CONTROLLER', 'inventory.transfer'),
    ('RECEIVER',             'locations.read'),
    ('RECEIVER',             'catalog.read'),
    ('RECEIVER',             'inventory.read'),
    ('PUTAWAY_OPERATOR',     'locations.read'),
    ('PUTAWAY_OPERATOR',     'catalog.read'),
    ('PUTAWAY_OPERATOR',     'inventory.read'),
    ('PUTAWAY_OPERATOR',     'inventory.transfer'),
    ('PICKER',               'locations.read'),
    ('PICKER',               'catalog.read'),
    ('PICKER',               'inventory.read'),
    ('PACKER',               'catalog.read'),
    ('PACKER',               'inventory.read')
  ) AS m (role_code, permission_code)
  JOIN identity.role r ON r.code = m.role_code
  JOIN identity.permission p ON p.code = m.permission_code
ON CONFLICT DO NOTHING;