import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import {
  CheckLedgerIntegrity,
  PgLedgerAuditor,
  PgStockLedger,
  type LedgerAuditor,
  type LedgerDiscrepancy,
} from "../../modules/inventory/index.js";
import { createMovement } from "../../modules/inventory/domain/stock-movement.js";

const WH = "00000000-0000-0000-0000-000000000001";

const discrepancy = (n: number): LedgerDiscrepancy => ({
  warehouseId: WH,
  sku: `SKU-${n}`,
  locationId: "A-01",
  ledgerQuantity: 10,
  cachedQuantity: 11,
});

/** An auditor that returns canned rows and remembers the limit it was asked for. */
function fakeAuditor(rows: LedgerDiscrepancy[]) {
  const limits: number[] = [];
  const auditor: LedgerAuditor = {
    async findDiscrepancies(limit) {
      limits.push(limit);
      return rows.slice(0, limit);
    },
  };
  return { auditor, limits };
}

function spyLog() {
  const info: [string, Record<string, unknown> | undefined][] = [];
  const error: [string, Record<string, unknown> | undefined][] = [];
  return {
    info,
    error,
    log: {
      info: (m: string, c?: Record<string, unknown>) => {
        info.push([m, c]);
      },
      error: (m: string, c?: Record<string, unknown>) => {
        error.push([m, c]);
      },
    },
  };
}

describe("CheckLedgerIntegrity", () => {
  it("passes and logs at info level when the ledger and the cache agree", async () => {
    const { auditor } = fakeAuditor([]);
    const spy = spyLog();

    const report = await new CheckLedgerIntegrity(auditor, spy.log).execute();

    expect(report.ok).toBe(true);
    expect(report.discrepancies).toEqual([]);
    expect(spy.info).toHaveLength(1);
    expect(spy.error).toHaveLength(0);
  });

  it("fails with an error log that names the mismatching keys", async () => {
    const { auditor } = fakeAuditor([discrepancy(1), discrepancy(2)]);
    const spy = spyLog();

    const report = await new CheckLedgerIntegrity(auditor, spy.log).execute();

    expect(report.ok).toBe(false);
    expect(report.discrepancies).toHaveLength(2);
    expect(spy.error).toHaveLength(1);
    const [message, ctx] = spy.error[0] ?? ["", undefined];
    expect(message).toContain("FAILED");
    expect(ctx?.discrepancies).toBe(2);
    expect(ctx?.sample).toEqual([discrepancy(1), discrepancy(2)]);
  });

  it("reports when more discrepancies exist than it lists", async () => {
    const rows = [1, 2, 3, 4, 5].map(discrepancy);
    const { auditor, limits } = fakeAuditor(rows);

    const report = await new CheckLedgerIntegrity(auditor, spyLog().log, 3).execute();

    expect(limits).toEqual([4]); // asks for one more than it will list
    expect(report.truncated).toBe(true);
    expect(report.discrepancies).toHaveLength(3);
  });

  it("is not truncated when there are exactly as many as it lists", async () => {
    const { auditor } = fakeAuditor([1, 2, 3].map(discrepancy));
    const report = await new CheckLedgerIntegrity(auditor, spyLog().log, 3).execute();
    expect(report.truncated).toBe(false);
    expect(report.discrepancies).toHaveLength(3);
  });
});

const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";

describe.skipIf(!postgresEnabled)("PgLedgerAuditor", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  const ledger = new PgStockLedger(pool);
  const auditor = new PgLedgerAuditor(pool);
  const newSku = () => `SKU-${randomUUID()}`;
  const newWarehouse = () => randomUUID();
  const deposit = (warehouseId: string, sku: string, delta: number) =>
    createMovement({
      warehouseId,
      sku,
      locationId: "A-01",
      quantityDelta: delta,
      type: "ADJUSTMENT",
    });

  // The shared dev database may hold unrelated rows, so every check looks at one SKU only.
  const forSku = async (sku: string) =>
    (await auditor.findDiscrepancies(100_000)).filter((d) => d.sku === sku);

  it("finds nothing when movements and balances agree", async () => {
    const [w, sku] = [newWarehouse(), newSku()];
    await ledger.append([deposit(w, sku, 10)]);
    await ledger.append([deposit(w, sku, -3)]);
    expect(await forSku(sku)).toEqual([]);
  });

  it("finds a cached balance that drifted from the ledger", async () => {
    const [w, sku] = [newWarehouse(), newSku()];
    await ledger.append([deposit(w, sku, 10)]);
    await pool.query(
      `UPDATE inventory.stock_levels SET quantity = quantity + 1
        WHERE warehouse_id = $1 AND sku = $2 AND location_id = 'A-01'`,
      [w, sku],
    );
    try {
      expect(await forSku(sku)).toEqual([
        { warehouseId: w, sku, locationId: "A-01", ledgerQuantity: 10, cachedQuantity: 11 },
      ]);
    } finally {
      await pool.query(
        `UPDATE inventory.stock_levels SET quantity = quantity - 1
          WHERE warehouse_id = $1 AND sku = $2 AND location_id = 'A-01'`,
        [w, sku],
      );
    }
    expect(await forSku(sku)).toEqual([]);
  });

  it("flags only the warehouse whose balance drifted", async () => {
    const [w1, w2, sku] = [newWarehouse(), newWarehouse(), newSku()];
    await ledger.append([deposit(w1, sku, 10), deposit(w2, sku, 10)]);
    await pool.query(
      `UPDATE inventory.stock_levels SET quantity = quantity + 1
        WHERE warehouse_id = $1 AND sku = $2 AND location_id = 'A-01'`,
      [w2, sku],
    );
    try {
      expect(await forSku(sku)).toEqual([
        { warehouseId: w2, sku, locationId: "A-01", ledgerQuantity: 10, cachedQuantity: 11 },
      ]);
    } finally {
      await pool.query(
        `UPDATE inventory.stock_levels SET quantity = quantity - 1
          WHERE warehouse_id = $1 AND sku = $2 AND location_id = 'A-01'`,
        [w2, sku],
      );
    }
  });

  it("finds a movement that has no balance row", async () => {
    const [w, sku, id] = [newWarehouse(), newSku(), randomUUID()];
    // Bypasses the ledger on purpose, to simulate corruption. The test removes the row
    // afterwards; the ledger itself is append-only.
    await pool.query(
      `INSERT INTO inventory.stock_movements (id, warehouse_id, sku, location_id, quantity_delta, type)
       VALUES ($1, $2, $3, 'A-01', 7, 'ADJUSTMENT')`,
      [id, w, sku],
    );
    try {
      expect(await forSku(sku)).toEqual([
        { warehouseId: w, sku, locationId: "A-01", ledgerQuantity: 7, cachedQuantity: 0 },
      ]);
    } finally {
      await pool.query("DELETE FROM inventory.stock_movements WHERE id = $1", [id]);
    }
  });

  it("finds a balance row that has no movements", async () => {
    const [w, sku] = [newWarehouse(), newSku()];
    await pool.query(
      `INSERT INTO inventory.stock_levels (warehouse_id, sku, location_id, quantity)
       VALUES ($1, $2, 'A-01', 5)`,
      [w, sku],
    );
    try {
      expect(await forSku(sku)).toEqual([
        { warehouseId: w, sku, locationId: "A-01", ledgerQuantity: 0, cachedQuantity: 5 },
      ]);
    } finally {
      await pool.query("DELETE FROM inventory.stock_levels WHERE sku = $1", [sku]);
    }
  });

  it("never raises a false alarm while writes are in flight", async () => {
    const [w, sku] = [newWarehouse(), newSku()];
    await ledger.append([deposit(w, sku, 1000)]);

    let writing = true;
    const writers = Promise.all(
      Array.from({ length: 30 }, () => ledger.append([deposit(w, sku, -1)])),
    );
    const seen: LedgerDiscrepancy[] = [];
    const auditing = (async () => {
      while (writing) seen.push(...(await forSku(sku)));
    })();

    await writers;
    writing = false;
    await auditing;

    expect(seen).toEqual([]);
    expect(await forSku(sku)).toEqual([]);
  });
});
