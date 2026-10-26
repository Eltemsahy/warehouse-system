import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createInventoryModule, PgStockLedger } from "../../modules/inventory/index.js";

const enabled = process.env.LEDGER_DRIVER === "postgres";

describe.skipIf(!enabled)("inventory (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  const newInventory = () => createInventoryModule({ ledger: new PgStockLedger(pool) });

  it("never lets concurrent withdrawals overdraw stock", async () => {
    const inv = newInventory();
    const [warehouseId, sku] = [randomUUID(), `SKU-${randomUUID()}`];
    await inv.adjust.execute({ warehouseId, sku, locationId: "A-01", delta: 10, reason: "seed" });

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        inv.adjust.execute({ warehouseId, sku, locationId: "A-01", delta: -1, reason: "race" }),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await inv.getBalance(warehouseId, sku, "A-01")).toBe(0);
  });

  it("transfers stock from an existing balance", async () => {
    const inv = newInventory();
    const [warehouseId, sku] = [randomUUID(), `SKU-${randomUUID()}`];
    await inv.adjust.execute({ warehouseId, sku, locationId: "A-01", delta: 10, reason: "seed" });

    const result = await inv.transfer.execute({
      warehouseId,
      sku,
      from: "A-01",
      to: "B-02",
      quantity: 4,
    });

    expect(result.ok).toBe(true);
    expect(await inv.getBalance(warehouseId, sku, "A-01")).toBe(6);
    expect(await inv.getBalance(warehouseId, sku, "B-02")).toBe(4);
  });

  it("keeps two warehouses with the same location code apart", async () => {
    const inv = newInventory();
    const [w1, w2, sku] = [randomUUID(), randomUUID(), `SKU-${randomUUID()}`];
    await inv.adjust.execute({
      warehouseId: w1,
      sku,
      locationId: "A-01",
      delta: 10,
      reason: "seed",
    });
    await inv.adjust.execute({
      warehouseId: w2,
      sku,
      locationId: "A-01",
      delta: 3,
      reason: "seed",
    });

    expect(await inv.getBalance(w1, sku, "A-01")).toBe(10);
    expect(await inv.getBalance(w2, sku, "A-01")).toBe(3);
  });
});
