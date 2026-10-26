// PUBLIC INTERFACE of the inventory module. Other modules import ONLY from here.
import { AdjustStock } from "./application/adjust-stock.js";
import { CheckLedgerIntegrity } from "./application/check-ledger-integrity.js";
import { TransferStock } from "./application/transfer-stock.js";
import type { LedgerAuditor, StockLedger } from "./application/ports.js";
import { InMemoryLedger } from "./infrastructure/in-memory-ledger.js";
import { inventoryRoutes } from "./api/routes.js";

/**
 * Events are no longer published directly: the ledger stores them in the outbox in the same
 * transaction as the stock change, and the composition root runs the relay (see app.ts).
 */
export function createInventoryModule(
  deps: { ledger?: StockLedger; auditor?: LedgerAuditor } = {},
) {
  const ledger = deps.ledger ?? new InMemoryLedger();
  const adjust = new AdjustStock(ledger);
  const transfer = new TransferStock(ledger);
  return {
    router: inventoryRoutes({ adjust, transfer, ledger }),
    // Public query used by other modules (e.g. outbound allocation)
    getBalance: (warehouseId: string, sku: string, locationId: string) =>
      ledger.balance(warehouseId, sku, locationId),
    adjust,
    transfer,
    // Only when an auditor is supplied: the in-memory ledger has nothing to compare against.
    checkIntegrity: deps.auditor ? new CheckLedgerIntegrity(deps.auditor) : undefined,
  };
}
export type { LedgerAuditor, LedgerDiscrepancy, StockLedger } from "./application/ports.js";
export {
  CheckLedgerIntegrity,
  type LedgerIntegrityReport,
} from "./application/check-ledger-integrity.js";
export { InMemoryLedger } from "./infrastructure/in-memory-ledger.js";
export { PgLedgerAuditor } from "./infrastructure/pg-ledger-auditor.js";
export { PgStockLedger } from "./infrastructure/pg-stock-ledger.js";
