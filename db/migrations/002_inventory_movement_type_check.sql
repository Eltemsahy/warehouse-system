-- TRD G7: stock_movements.type was unconstrained text.
-- Values match modules/inventory/domain/stock-movement.ts (MovementType).
-- Add new types here via a new migration when a module introduces them.
ALTER TABLE inventory.stock_movements
  ADD CONSTRAINT stock_movements_type_chk
  CHECK (type IN ('RECEIPT', 'ISSUE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT'));
