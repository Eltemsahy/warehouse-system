// PUBLIC INTERFACE of the inventory module. Other modules import ONLY from here.
import { AdjustStock } from "./application/adjust-stock.js";
import { TransferStock } from "./application/transfer-stock.js";
import type { StockLedger } from "./application/ports.js";
import { InMemoryLedger } from "./infrastructure/in-memory-ledger.js";
import { inventoryRoutes } from "./api/routes.js";

/**
 * Events are no longer published directly: the ledger stores them in the outbox in the same
 * transaction as the stock change, and the composition root runs the relay (see app.ts).
 */
export function createInventoryModule(deps: { ledger?: StockLedger } = {}) {
  const ledger = deps.ledger ?? new InMemoryLedger();
  const adjust = new AdjustStock(ledger);
  const transfer = new TransferStock(ledger);
  return {
    router: inventoryRoutes({ adjust, transfer, ledger }),
    // Public query used by other modules (e.g. outbound allocation)
    getBalance: (sku: string, locationId: string) => ledger.balance(sku, locationId),
    adjust, transfer,
  };
}
export type { StockLedger } from "./application/ports.js";
export { InMemoryLedger } from "./infrastructure/in-memory-ledger.js";
export { PgStockLedger } from "./infrastructure/pg-stock-ledger.js";