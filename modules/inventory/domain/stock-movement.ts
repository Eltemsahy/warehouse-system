import { newId } from "../../../shared/kernel/index.js";

export type MovementType = "RECEIPT" | "ISSUE" | "ADJUSTMENT" | "TRANSFER_IN" | "TRANSFER_OUT";

/** One immutable line in the stock ledger. Balances are derived from these. */
export interface StockMovement {
  readonly id: string;
  readonly sku: string;
  readonly locationId: string;
  readonly quantityDelta: number; // signed
  readonly type: MovementType;
  readonly reason?: string;
  readonly referenceId?: string; // PO, order, transfer id...
  readonly occurredAt: Date;
}

export function createMovement(input: Omit<StockMovement, "id" | "occurredAt">): StockMovement {
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    throw new Error("quantityDelta must be a non-zero number");
  }
  return { ...input, id: newId(), occurredAt: new Date() };
}
