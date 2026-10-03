CREATE SCHEMA IF NOT EXISTS inventory;

-- Append-only ledger: never UPDATE or DELETE rows.
CREATE TABLE IF NOT EXISTS inventory.stock_movements (
  id             uuid PRIMARY KEY,
  sku            text        NOT NULL,
  location_id    text        NOT NULL,
  quantity_delta integer     NOT NULL CHECK (quantity_delta <> 0),
  type           text        NOT NULL,
  reason         text,
  reference_id   text,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_sku_loc_idx ON inventory.stock_movements (sku, location_id);

-- Cached balance, updated in the same transaction as the ledger insert.
CREATE TABLE IF NOT EXISTS inventory.stock_levels (
  sku         text    NOT NULL,
  location_id text    NOT NULL,
  quantity    integer NOT NULL CHECK (quantity >= 0),
  version     integer NOT NULL DEFAULT 0, -- optimistic locking
  PRIMARY KEY (sku, location_id)
);
