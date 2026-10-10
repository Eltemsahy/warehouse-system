import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createInventoryModule, PgStockLedger } from "../../modules/inventory/index.js";

const enabled = process.env.LEDGER_DRIVER === "postgres";

describe.skipIf(!enabled)("inventory (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  it("never lets concurrent withdrawals overdraw stock", async () => {
    const inv = createInventoryModule({ ledger: new PgStockLedger(pool) });
    const sku = `SKU-${Date.now()}`;
    await inv.adjust.execute({ sku, locationId: "A-01", delta: 10, reason: "seed" });

    const results = await Promise.all(
      Array.from({ length: 20 }, () => inv.adjust.execute({ sku, locationId: "A-01", delta: -1, reason: "race" })),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await inv.getBalance(sku, "A-01")).toBe(0);
  });

  it("transfers stock from an existing balance", async () => {
    const inv = createInventoryModule({ ledger: new PgStockLedger(pool) });
    const sku = `SKU-${Date.now()}`;
    await inv.adjust.execute({ sku, locationId: "A-01", delta: 10, reason: "seed" });

    const result = await inv.transfer.execute({ sku, from: "A-01", to: "B-02", quantity: 4 });

    expect(result.ok).toBe(true);
    expect(await inv.getBalance(sku, "A-01")).toBe(6);
    expect(await inv.getBalance(sku, "B-02")).toBe(4);
  });
});