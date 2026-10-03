import type { StockMovement } from "../domain/stock-movement.js";

export interface StockLedger {
  /** Must append all movements atomically (single DB transaction). */
  append(movements: StockMovement[]): Promise<void>;
  balance(sku: string, locationId: string): Promise<number>;
}
