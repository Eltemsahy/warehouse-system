import { err, ok, type Result } from "../../../shared/kernel/index.js";
import type { InMemoryEventBus } from "../../../shared/events/index.js";
import { InsufficientStockError } from "../domain/errors.js";
import { createMovement, type StockMovement } from "../domain/stock-movement.js";
import { stockAdjusted } from "../domain/events.js";
import type { StockLedger } from "./ports.js";

export interface AdjustStockInput { sku: string; locationId: string; delta: number; reason: string }

export class AdjustStock {
  constructor(private ledger: StockLedger, private bus: InMemoryEventBus) {}

  async execute(i: AdjustStockInput): Promise<Result<StockMovement>> {
    if (i.delta === 0) return err(new Error("delta must be non-zero"));
    const current = await this.ledger.balance(i.sku, i.locationId);
    if (current + i.delta < 0) return err(new Error("insufficient stock: balance cannot go negative"));

    const movement = createMovement({
      sku: i.sku, locationId: i.locationId, quantityDelta: i.delta,
      type: "ADJUSTMENT", reason: i.reason,
    });
    try {
      await this.ledger.append([movement]);
    } catch (e) {
      if (e instanceof InsufficientStockError) return err(e);
      throw e;
    }
    await this.bus.publish([stockAdjusted(movement)]);
    return ok(movement);
  }
}
