-- P1-4 step 2: barcodes. A barcode identifies an item IN A UNIT (a case barcode means 12 each),
-- so it points at an item unit; the composite foreign key proves that unit belongs to the same
-- item. Barcodes are organisation-wide and match exactly (scanners send exact text).
ALTER TABLE catalog.item_uom ADD CONSTRAINT item_uom_id_item_key UNIQUE (id, item_id);

CREATE TABLE catalog.item_barcode (
  id           uuid        PRIMARY KEY,
  item_id      uuid        NOT NULL REFERENCES catalog.item (id),
  item_uom_id  uuid        NOT NULL,
  barcode      text        NOT NULL,
  type         text        NOT NULL DEFAULT 'OTHER',
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  -- Printable ASCII without spaces, 1 to 128 characters.
  CONSTRAINT item_barcode_format CHECK (barcode ~ '^[!-~]{1,128}$'),
  CONSTRAINT item_barcode_type_chk CHECK (
    type IN ('EAN13', 'EAN8', 'UPC_A', 'ITF14', 'CODE128', 'OTHER')
  ),
  CONSTRAINT item_barcode_barcode_key UNIQUE (barcode),
  CONSTRAINT item_barcode_unit_same_item
    FOREIGN KEY (item_uom_id, item_id) REFERENCES catalog.item_uom (id, item_id)
);
CREATE INDEX item_barcode_item_idx ON catalog.item_barcode (item_id);