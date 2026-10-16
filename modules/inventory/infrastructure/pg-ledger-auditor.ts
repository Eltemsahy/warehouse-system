import type { Pool } from "pg";
import type { LedgerAuditor, LedgerDiscrepancy } from "../application/ports.js";

interface Row {
  sku: string;
  location_id: string;
  ledger_quantity: string; // bigint comes back as text
  cached_quantity: number;
}

export class PgLedgerAuditor implements LedgerAuditor {
  constructor(private pool: Pool) {}

  async findDiscrepancies(limit: number): Promise<LedgerDiscrepancy[]> {
    // ONE statement, so both sides are read from the same snapshot: a transaction that is
    // half-way through a write (movement inserted, balance not yet updated) can never show
    // up as a false alarm. FULL JOIN also catches a movement with no balance row and a
    // balance row with no movements.
    const { rows } = await this.pool.query<Row>(
      `SELECT sku,
              location_id,
              COALESCE(m.ledger_sum, 0)::text AS ledger_quantity,
              COALESCE(l.quantity, 0)         AS cached_quantity
         FROM (SELECT sku, location_id, SUM(quantity_delta) AS ledger_sum
                 FROM inventory.stock_movements
                GROUP BY sku, location_id) m
         FULL OUTER JOIN inventory.stock_levels l USING (sku, location_id)
        WHERE COALESCE(m.ledger_sum, 0) <> COALESCE(l.quantity, 0)
        ORDER BY sku, location_id
        LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      sku: r.sku,
      locationId: r.location_id,
      ledgerQuantity: Number(r.ledger_quantity),
      cachedQuantity: r.cached_quantity,
    }));
  }
}
