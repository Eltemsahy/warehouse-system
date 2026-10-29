-- ADR 0004: the warehouse leads every inventory key, so two warehouses can both have a
-- location "A-01" without sharing a balance (TRD gap G13).
--
-- Rows that already exist (development data) are assigned to a placeholder warehouse. The
-- default is then dropped, so every new row has to name its warehouse.
ALTER TABLE inventory.stock_movements
  ADD COLUMN warehouse_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE inventory.stock_movements ALTER COLUMN warehouse_id DROP DEFAULT;

ALTER TABLE inventory.stock_levels
  ADD COLUMN warehouse_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE inventory.stock_levels ALTER COLUMN warehouse_id DROP DEFAULT;

ALTER TABLE inventory.stock_levels DROP CONSTRAINT stock_levels_pkey;
ALTER TABLE inventory.stock_levels ADD PRIMARY KEY (warehouse_id, sku, location_id);

DROP INDEX inventory.stock_movements_sku_loc_idx;
CREATE INDEX stock_movements_wh_sku_loc_idx
  ON inventory.stock_movements (warehouse_id, sku, location_id);
  