-- P1-6 demo data for development (Implementation Plan P1-6; the Phase 1 exit gate asks for a
-- seeded demo warehouse). Run with `npm run seed` after `npm run migrate`.
--
-- Safe to run again: every statement skips rows that already exist and never overwrites or
-- deletes anything. The demo warehouse uses the placeholder id that migration 005 gave to
-- stock written before master data existed (00000000-0000-0000-0000-000000000001), so such
-- development stock attaches to it again. Starting stock goes in as ledger movements together
-- with the cached balance, so `npm run check:ledger` stays clean. Barcodes use the GS1 "internal
-- use" prefix 200, so they never collide with real products.
-- Not for production: the runner refuses to seed when NODE_ENV=production.

-- ---- locations: one warehouse, its zones and locations

INSERT INTO locations.warehouse (id, code, name, address, timezone, status)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'DEMO', 'Demo warehouse', 'Demo address, not a real place', 'UTC', 'ACTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO locations.zone (id, warehouse_id, code, type)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001'::uuid, v.code, v.type
  FROM (VALUES
         ('RECV', 'RECEIVING'),
         ('BULK', 'STORAGE'),
         ('PICK', 'PICKING'),
         ('SHIP', 'SHIPPING')
       ) AS v(code, type)
ON CONFLICT DO NOTHING;

INSERT INTO locations.location (id, warehouse_id, zone_id, location_type_id, code, aisle, bay, level)
SELECT gen_random_uuid(), '00000000-0000-0000-0000-000000000001'::uuid, z.id, t.id, v.code, v.aisle, v.bay, v.level
  FROM (VALUES
         ('A-01',    'PICK', 'BIN',     'A', '01', '1'),
         ('A-02',    'PICK', 'BIN',     'A', '02', '1'),
         ('A-03',    'PICK', 'BIN',     'A', '03', '1'),
         ('B-01',    'BULK', 'PALLET',  'B', '01', NULL),
         ('B-02',    'BULK', 'PALLET',  'B', '02', NULL),
         ('B-03',    'BULK', 'PALLET',  'B', '03', NULL),
         ('RECV-01', 'RECV', 'STAGING', NULL, NULL, NULL),
         ('SHIP-01', 'SHIP', 'STAGING', NULL, NULL, NULL)
       ) AS v(code, zone, type, aisle, bay, level)
  JOIN locations.zone z ON z.warehouse_id = '00000000-0000-0000-0000-000000000001'::uuid AND lower(z.code) = lower(v.zone)
  JOIN locations.location_type t ON lower(t.code) = lower(v.type)
ON CONFLICT DO NOTHING;

INSERT INTO locations.location_capacity (location_id, max_units)
SELECT l.id, 500
  FROM locations.location l
 WHERE l.warehouse_id = '00000000-0000-0000-0000-000000000001'::uuid AND l.code LIKE 'A-%'
ON CONFLICT DO NOTHING;

INSERT INTO locations.location_storage_class (location_id, storage_class_id)
SELECT l.id, c.id
  FROM locations.location l
  JOIN locations.storage_class c ON c.code = 'AMBIENT'
 WHERE l.warehouse_id = '00000000-0000-0000-0000-000000000001'::uuid
ON CONFLICT DO NOTHING;

-- ---- catalog: categories, items, their units and barcodes

INSERT INTO catalog.item_category (id, parent_id, code, name)
VALUES (gen_random_uuid(), NULL, 'GENERAL', 'General goods'),
       (gen_random_uuid(), NULL, 'FOOD', 'Food')
ON CONFLICT DO NOTHING;

INSERT INTO catalog.item_category (id, parent_id, code, name)
SELECT gen_random_uuid(), p.id, 'BEVERAGE', 'Beverages'
  FROM catalog.item_category p
 WHERE p.code = 'FOOD'
ON CONFLICT DO NOTHING;

INSERT INTO catalog.item
  (id, sku, description, category_id, base_uom_id, is_lot_tracked, has_expiry, shelf_life_days)
SELECT gen_random_uuid(), v.sku, v.description, c.id, u.id, v.lot, v.expiry, v.shelf
  FROM (VALUES
         ('SKU-1',      'Test item',            'GENERAL',  false, false, NULL::integer),
         ('WIDGET-100', 'Widget, small',        'GENERAL',  false, false, NULL),
         ('JAM-200',    'Strawberry jam 370 g', 'FOOD',     true,  true,  365),
         ('WATER-300',  'Mineral water 1.5 L',  'BEVERAGE', true,  true,  730),
         ('BOLT-400',   'Steel bolt M8 x 40',   'GENERAL',  false, false, NULL)
       ) AS v(sku, description, category, lot, expiry, shelf)
  JOIN catalog.item_category c ON c.code = v.category
  JOIN catalog.uom u ON u.code = 'EA'
ON CONFLICT DO NOTHING;

-- Every item has its base unit (EA, quantity 1); some also have a case or a pallet.
INSERT INTO catalog.item_uom (id, item_id, uom_id, qty_in_base, length, width, height, weight)
SELECT gen_random_uuid(), i.id, u.id, v.qty, v.length, v.width, v.height, v.weight
  FROM (VALUES
         ('SKU-1',      'EA', 1,   NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric),
         ('WIDGET-100', 'EA', 1,   10,  8,  5,   0.35),
         ('WIDGET-100', 'CS', 24,  40,  30, 20,  8.9),
         ('JAM-200',    'EA', 1,   7,   7,  10,  0.45),
         ('JAM-200',    'CS', 12,  30,  22, 12,  5.6),
         ('WATER-300',  'EA', 1,   9,   9,  31,  1.55),
         ('WATER-300',  'CS', 6,   28,  19, 32,  9.5),
         ('WATER-300',  'PL', 360, 120, 80, 150, 570),
         ('BOLT-400',   'EA', 1,   NULL, NULL, NULL, 0.02),
         ('BOLT-400',   'CS', 500, 20,  15, 10,  10.5)
       ) AS v(sku, uom, qty, length, width, height, weight)
  JOIN catalog.item i ON i.sku = v.sku
  JOIN catalog.uom u ON u.code = v.uom
ON CONFLICT DO NOTHING;

INSERT INTO catalog.item_barcode (id, item_id, item_uom_id, barcode, type)
SELECT gen_random_uuid(), i.id, iu.id, v.barcode, v.type
  FROM (VALUES
  ('SKU-1', 'EA', 'EAN13', '2000000000015'),
  ('WIDGET-100', 'EA', 'EAN13', '2000000000022'),
  ('WIDGET-100', 'CS', 'ITF14', '12000000000036'),
  ('JAM-200', 'EA', 'EAN13', '2000000000046'),
  ('JAM-200', 'CS', 'ITF14', '12000000000050'),
  ('WATER-300', 'EA', 'EAN13', '2000000000060'),
  ('WATER-300', 'CS', 'ITF14', '12000000000074'),
  ('BOLT-400', 'CS', 'ITF14', '12000000000081')
       ) AS v(sku, uom, type, barcode)
  JOIN catalog.item i ON i.sku = v.sku
  JOIN catalog.uom u ON u.code = v.uom
  JOIN catalog.item_uom iu ON iu.item_id = i.id AND iu.uom_id = u.id
ON CONFLICT DO NOTHING;

-- ---- inventory: starting stock. The movement is written only when the balance row is new, so
-- running the seed again adds nothing, and the ledger and the cached balances always agree.

WITH seeded AS (
  INSERT INTO inventory.stock_levels (warehouse_id, sku, location_id, quantity)
  VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'BOLT-400',   'A-01', 300),
         ('00000000-0000-0000-0000-000000000001'::uuid, 'WIDGET-100', 'A-02', 120),
         ('00000000-0000-0000-0000-000000000001'::uuid, 'WIDGET-100', 'B-01', 480),
         ('00000000-0000-0000-0000-000000000001'::uuid, 'JAM-200',    'A-03', 60),
         ('00000000-0000-0000-0000-000000000001'::uuid, 'WATER-300',  'B-03', 200)
  ON CONFLICT DO NOTHING
  RETURNING warehouse_id, sku, location_id, quantity
)
INSERT INTO inventory.stock_movements
  (id, warehouse_id, sku, location_id, quantity_delta, type, reason)
SELECT gen_random_uuid(), warehouse_id, sku, location_id, quantity, 'ADJUSTMENT', 'dev seed'
  FROM seeded;