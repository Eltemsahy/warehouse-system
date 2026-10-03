// PUBLIC INTERFACE of the inventory module. Other modules import ONLY from here.
import type { InMemoryEventBus } from "../../shared/events/index.js";
import { AdjustStock } from "./application/adjust-stock.js";
import { TransferStock } from "./application/transfer-stock.js";
import type { StockLedger } from "./application/ports.js";
import { InMemoryLedger } from "./infrastructure/in-memory-ledger.js";
import { inventoryRoutes } from "./api/routes.js";

export function createInventoryModule(deps: { bus: InMemoryEventBus; ledger?: StockLedger }) {
  const ledger = deps.ledger ?? new InMemoryLedger();
  const adjust = new AdjustStock(ledger, deps.bus);
  const transfer = new TransferStock(ledger, deps.bus);
  return {
    router: inventoryRoutes({ adjust, transfer, ledger }),
    // Public query used by other modules (e.g. outbound allocation)
    getBalance: (sku: string, locationId: string) => ledger.balance(sku, locationId),
    adjust, transfer,
  };
}
export type { StockLedger } from "./application/ports.js";
