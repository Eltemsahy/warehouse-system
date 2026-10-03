# ADR 0002: Inventory as an append-only movement ledger

- **Status:** Accepted
- **Decision:** All stock changes are rows in `inventory.stock_movements`. Balances are derived/cached and updated in the same transaction.
- **Consequences:** Full audit trail, easy reconciliation. Corrections are new movements, never edits.
