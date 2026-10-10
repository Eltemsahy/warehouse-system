import type { DomainEvent } from "../../../shared/kernel/index.js";
import type { StockMovement } from "../domain/stock-movement.js";

export interface StockLedger {
  /**
   * Must append all movements AND persist `events` atomically (single DB transaction).
   * If any movement is rejected, no movement and no event is stored. Events are delivered
   * later by the outbox relay, so a crash after commit never loses them (TRD s5.4).
   */
  append(movements: StockMovement[], events?: readonly DomainEvent[]): Promise<void>;
  balance(sku: string, locationId: string): Promise<number>;
}
