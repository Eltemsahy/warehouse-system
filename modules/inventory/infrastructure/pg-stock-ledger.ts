import type { Pool } from "pg";
import { insertOutboxEvents } from "../../../shared/events/index.js";
import type { DomainEvent } from "../../../shared/kernel/index.js";
import type { StockLedger } from "../application/ports.js";
import type { StockMovement } from "../domain/stock-movement.js";
import { InsufficientStockError } from "../domain/errors.js";

const CHECK_VIOLATION = "23514";

export class PgStockLedger implements StockLedger {
  constructor(private pool: Pool) {}

  async append(movements: StockMovement[], events: readonly DomainEvent[] = []): Promise<void> {
    if (movements.length === 0 && events.length === 0) return;

    // Fixed lock order (warehouse, sku, location) so concurrent transfers can't deadlock.
    const ordered = [...movements].sort(
      (a, b) =>
        a.warehouseId.localeCompare(b.warehouseId) ||
        a.sku.localeCompare(b.sku) ||
        a.locationId.localeCompare(b.locationId),
    );

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Stored first, inside the same transaction: a rejected movement below rolls it back.
      await insertOutboxEvents(client, events);
      for (const m of ordered) {
        await client.query(
          `INSERT INTO inventory.stock_movements
             (id, warehouse_id, sku, location_id, quantity_delta, type, reason, reference_id, occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            m.id,
            m.warehouseId,
            m.sku,
            m.locationId,
            m.quantityDelta,
            m.type,
            m.reason ?? null,
            m.referenceId ?? null,
            m.occurredAt,
          ],
        );
        // Update first: the CHECK (quantity >= 0) is then evaluated on the RESULTING balance.
        // An upsert would test the proposed row (e.g. -4) before resolving the conflict.
        const upd = await client.query(
          `UPDATE inventory.stock_levels
              SET quantity = quantity + $4, version = version + 1
            WHERE warehouse_id = $1 AND sku = $2 AND location_id = $3`,
          [m.warehouseId, m.sku, m.locationId, m.quantityDelta],
        );
        if (upd.rowCount === 0) {
          // No row yet: a negative first movement is a genuine overdraft.
          if (m.quantityDelta < 0) throw new InsufficientStockError();
          await client.query(
            `INSERT INTO inventory.stock_levels (warehouse_id, sku, location_id, quantity)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (warehouse_id, sku, location_id) DO UPDATE
               SET quantity = inventory.stock_levels.quantity + EXCLUDED.quantity,
                   version  = inventory.stock_levels.version + 1`,
            [m.warehouseId, m.sku, m.locationId, m.quantityDelta],
          );
        }
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

  async balance(warehouseId: string, sku: string, locationId: string): Promise<number> {
    const { rows } = await this.pool.query<{ quantity: number }>(
      `SELECT quantity FROM inventory.stock_levels
        WHERE warehouse_id = $1 AND sku = $2 AND location_id = $3`,
      [warehouseId, sku, locationId],
    );
    return rows[0]?.quantity ?? 0;
  }
}
