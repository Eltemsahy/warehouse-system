import type { DomainEvent } from "../../../shared/kernel/index.js";
import type { StockMovement } from "../domain/stock-movement.js";

export interface StockLedger {
  /**
   * Must append all movements AND persist `events` atomically (single DB transaction).
   * If any movement is rejected, no movement and no event is stored. Events are delivered
   * later by the outbox relay, so a crash after commit never loses them (TRD s5.4).
   */
  append(movements: StockMovement[], events?: readonly DomainEvent[]): Promise<void>;
  /** Balance of one SKU at one location of one warehouse (ADR 0004). */
  balance(warehouseId: string, sku: string, locationId: string): Promise<number>;
}

/** A (warehouse, sku, location) whose cached balance no longer matches the ledger (ADR 0002). */
export interface LedgerDiscrepancy {
  warehouseId: string;
  sku: string;
  locationId: string;
  /** sum(quantity_delta) over the ledger: the source of truth. */
  ledgerQuantity: number;
  /** The cached stock_levels.quantity (0 when there is no row). */
  cachedQuantity: number;
}

/** Read-only comparison of the ledger with the cached balances. */
export interface LedgerAuditor {
  /** Returns up to `limit` keys whose ledger sum differs from the cached balance. */
  findDiscrepancies(limit: number): Promise<LedgerDiscrepancy[]>;
}
