import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { InsufficientStockError } from "../domain/errors.js";
import { createMovement } from "../domain/stock-movement.js";
import { stockTransferred } from "../domain/events.js";
import type { StockLedger, StockReferences } from "./ports.js";

/** A transfer stays inside one warehouse (ADR 0004). `from` and `to` are location codes. */
export interface TransferStockInput {
  warehouseId: string;
  sku: string;
  from: string;
  to: string;
  quantity: number;
}

export class TransferStock {
  constructor(
    private ledger: StockLedger,
    private references?: StockReferences,
  ) {}

  async execute(i: TransferStockInput): Promise<Result<{ transferId: string }>> {
    if (i.quantity <= 0) return err(new Error("quantity must be positive"));
    if (i.from === i.to) return err(new Error("source and destination must differ"));
    // The source may be retired (stock must be able to leave); the destination must be active.
    const problem =
      (await this.references?.problem(i.warehouseId, i.sku, i.from, "OUT")) ??
      (await this.references?.problem(i.warehouseId, i.sku, i.to, "IN"));
    if (problem) return err(new Error(problem));
    if ((await this.ledger.balance(i.warehouseId, i.sku, i.from)) < i.quantity) {
      return err(new Error("insufficient stock at source location"));
    }
    const transferId = newId();
    // Both legs and the event are stored in ONE atomic call (outbox).
    try {
      await this.ledger.append(
        [
          createMovement({
            warehouseId: i.warehouseId,
            sku: i.sku,
            locationId: i.from,
            quantityDelta: -i.quantity,
            type: "TRANSFER_OUT",
            referenceId: transferId,
          }),
          createMovement({
            warehouseId: i.warehouseId,
            sku: i.sku,
            locationId: i.to,
            quantityDelta: i.quantity,
            type: "TRANSFER_IN",
            referenceId: transferId,
          }),
        ],
        [stockTransferred({ ...i, transferId })],
      );
    } catch (e) {
      if (e instanceof InsufficientStockError) return err(e);
      throw e;
    }
    return ok({ transferId });
  }
}
