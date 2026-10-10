import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { InsufficientStockError } from "../domain/errors.js";
import { createMovement } from "../domain/stock-movement.js";
import { stockTransferred } from "../domain/events.js";
import type { StockLedger } from "./ports.js";

export interface TransferStockInput { sku: string; from: string; to: string; quantity: number }

export class TransferStock {
  constructor(private ledger: StockLedger) {}

  async execute(i: TransferStockInput): Promise<Result<{ transferId: string }>> {
    if (i.quantity <= 0) return err(new Error("quantity must be positive"));
    if (i.from === i.to) return err(new Error("source and destination must differ"));
    if ((await this.ledger.balance(i.sku, i.from)) < i.quantity) {
      return err(new Error("insufficient stock at source location"));
    }
    const transferId = newId();
    // Both legs and the event are stored in ONE atomic call (outbox).
    try {
      await this.ledger.append(
        [
          createMovement({ sku: i.sku, locationId: i.from, quantityDelta: -i.quantity, type: "TRANSFER_OUT", referenceId: transferId }),
          createMovement({ sku: i.sku, locationId: i.to, quantityDelta: i.quantity, type: "TRANSFER_IN", referenceId: transferId }),
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