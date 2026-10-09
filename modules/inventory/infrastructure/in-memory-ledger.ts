import type { StockLedger } from "../application/ports.js";
import { InsufficientStockError } from "../domain/errors.js";
import type { StockMovement } from "../domain/stock-movement.js";

const key = (sku: string, locationId: string) => `${sku}\u0000${locationId}`;

/** For tests and local dev. Honours the same contract as PgStockLedger. */
export class InMemoryLedger implements StockLedger {
  private levels = new Map<string, number>();

  async append(movements: StockMovement[]) {
    // Validate the whole batch against a working copy, then commit it. There is no await
    // between the check and the write, so this is atomic in a single-threaded process,
    // mirroring the Postgres transaction.
    const next = new Map<string, number>();
    for (const m of movements) {
      const k = key(m.sku, m.locationId);
      const updated = (next.get(k) ?? this.levels.get(k) ?? 0) + m.quantityDelta;
      if (updated < 0) throw new InsufficientStockError();
      next.set(k, updated);
    }
    for (const [k, quantity] of next) this.levels.set(k, quantity);
  }

  async balance(sku: string, locationId: string) {
    return this.levels.get(key(sku, locationId)) ?? 0;
  }
}