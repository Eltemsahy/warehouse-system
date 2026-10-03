import type { StockLedger } from "../application/ports.js";
import type { StockMovement } from "../domain/stock-movement.js";

/** For tests and local dev. Replace with a Postgres ledger (see db/migrations/001_inventory.sql). */
export class InMemoryLedger implements StockLedger {
  private movements: StockMovement[] = [];

  async append(movements: StockMovement[]) { this.movements.push(...movements); }

  async balance(sku: string, locationId: string) {
    return this.movements
      .filter((m) => m.sku === sku && m.locationId === locationId)
      .reduce((sum, m) => sum + m.quantityDelta, 0);
  }
}
