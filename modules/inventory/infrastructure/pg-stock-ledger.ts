import type { Pool } from "pg";
import type { StockLedger } from "../application/ports.js";
import type { StockMovement } from "../domain/stock-movement.js";
import { InsufficientStockError } from "../domain/errors.js";

const CHECK_VIOLATION = "23514";

export class PgStockLedger implements StockLedger {
  constructor(private pool: Pool) {}

  async append(movements: StockMovement[]): Promise<void> {
    if (movements.length === 0) return;

    // Fixed lock order (sku, location) so concurrent transfers can't deadlock.
    const ordered = [...movements].sort(
      (a, b) => a.sku.localeCompare(b.sku) || a.locationId.localeCompare(b.locationId),
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const m of ordered) {
        await client.query(
          `INSERT INTO inventory.stock_movements
             (id, sku, location_id, quantity_delta, type, reason, reference_id, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [m.id, m.sku, m.locationId, m.quantityDelta, m.type, m.reason ?? null, m.referenceId ?? null, m.occurredAt],
        );
        // Upsert takes a row lock; the CHECK (quantity >= 0) rejects overdrafts.
        await client.query(
          `INSERT INTO inventory.stock_levels (sku, location_id, quantity)
           VALUES ($1,$2,$3)
           ON CONFLICT (sku, location_id) DO UPDATE
             SET quantity = inventory.stock_levels.quantity + EXCLUDED.quantity,
                 version  = inventory.stock_levels.version + 1`,
          [m.sku, m.locationId, m.quantityDelta],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as { code?: string }).code === CHECK_VIOLATION) throw new InsufficientStockError();
      throw e;
    } finally {
      client.release();
    }
  }

  async balance(sku: string, locationId: string): Promise<number> {
    const { rows } = await this.pool.query<{ quantity: number }>(
      "SELECT quantity FROM inventory.stock_levels WHERE sku = $1 AND location_id = $2",
      [sku, locationId],
    );
    return rows[0]?.quantity ?? 0;
  }
}