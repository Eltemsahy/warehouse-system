import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import { createCatalogModule } from "../../modules/catalog/index.js";
import { createInventoryModule, MasterDataReferences } from "../../modules/inventory/index.js";
import { createLocationsModule } from "../../modules/locations/index.js";

function must<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Real locations and catalog modules, with inventory checking against them (P1-5). */
async function world() {
  const locations = createLocationsModule();
  const catalog = createCatalogModule();
  const inventory = createInventoryModule({
    references: new MasterDataReferences(locations, catalog),
  });

  const warehouse = must(
    await locations.warehouses.create({ code: `WH-${randomUUID().slice(0, 8)}`, name: "Main" }),
  );
  must(await locations.locations.create(warehouse.id, { code: "A-01", type: "BIN" }));
  must(await locations.locations.create(warehouse.id, { code: "B-02", type: "BIN" }));
  must(await catalog.items.create({ sku: "SKU-1", description: "Test item", baseUom: "EA" }));

  const w = warehouse.id;
  const adjust = (
    delta: number,
    over: { sku?: string; locationId?: string; warehouseId?: string } = {},
  ) =>
    inventory.adjust.execute({
      warehouseId: w,
      sku: "SKU-1",
      locationId: "A-01",
      delta,
      reason: "test",
      ...over,
    });
  const retireLocation = async (code: string) =>
    must(await locations.locations.update(w, code, { version: 1, isActive: false }));
  return { w, locations, catalog, inventory, adjust, retireLocation };
}

describe("inventory checks the master data", () => {
  it("accepts stock for a known warehouse, SKU and location", async () => {
    const { w, adjust, inventory } = await world();
    expect((await adjust(10)).ok).toBe(true);
    expect(await inventory.getBalance(w, "SKU-1", "A-01")).toBe(10);
  });

  it("rejects an unknown SKU, location or warehouse, and stores nothing", async () => {
    const { w, adjust, inventory } = await world();
    const cases: [string, Awaited<ReturnType<typeof adjust>>, string][] = [
      ["an unknown SKU", await adjust(5, { sku: "NOPE" }), "SKU"],
      ["an unknown location", await adjust(5, { locationId: "Z-99" }), "location"],
      ["an unknown warehouse", await adjust(5, { warehouseId: randomUUID() }), "warehouse"],
      ["case-different SKU", await adjust(5, { sku: "sku-1" }), "SKU"],
    ];
    for (const [label, result, word] of cases) {
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error.message, label).toContain(word);
    }
    expect(await inventory.getBalance(w, "SKU-1", "A-01")).toBe(0);
  });

  it("does not know a location through another warehouse", async () => {
    // Location codes are per warehouse (ADR 0004): B-02 exists only in the first warehouse.
    const { locations, adjust } = await world();
    const other = must(
      await locations.warehouses.create({ code: `WH-${randomUUID().slice(0, 8)}`, name: "Other" }),
    );
    const r = await adjust(5, { warehouseId: other.id, locationId: "B-02" });
    expect(r.ok).toBe(false);
  });

  it("refuses to add stock to an inactive location, SKU or warehouse", async () => {
    const w1 = await world();
    await w1.retireLocation("A-01");
    expect((await w1.adjust(5)).ok).toBe(false);

    const w2 = await world();
    must(await w2.catalog.items.update("SKU-1", { version: 1, status: "INACTIVE" }));
    expect((await w2.adjust(5)).ok).toBe(false);

    const w3 = await world();
    must(await w3.locations.warehouses.update(w3.w, { version: 1, status: "INACTIVE" }));
    expect((await w3.adjust(5)).ok).toBe(false);
  });

  it("lets stock be removed from an inactive location, SKU or warehouse", async () => {
    const a = await world();
    must(await a.adjust(10));
    await a.retireLocation("A-01");
    expect((await a.adjust(-4)).ok).toBe(true);
    expect(await a.inventory.getBalance(a.w, "SKU-1", "A-01")).toBe(6);

    const b = await world();
    must(await b.adjust(10));
    must(await b.catalog.items.update("SKU-1", { version: 1, status: "INACTIVE" }));
    expect((await b.adjust(-10)).ok).toBe(true);

    const c = await world();
    must(await c.adjust(10));
    must(await c.locations.warehouses.update(c.w, { version: 1, status: "INACTIVE" }));
    expect((await c.adjust(-10)).ok).toBe(true);
  });

  it("still rejects removing an unknown SKU", async () => {
    const { adjust } = await world();
    expect((await adjust(-1, { sku: "NOPE" })).ok).toBe(false);
  });

  it("checks both ends of a transfer", async () => {
    const { w, adjust, inventory, retireLocation } = await world();
    must(await adjust(10));
    const transfer = (to: string, from = "A-01") =>
      inventory.transfer.execute({ warehouseId: w, sku: "SKU-1", from, to, quantity: 4 });

    expect((await transfer("Z-99")).ok).toBe(false); // unknown destination
    expect(await inventory.getBalance(w, "SKU-1", "A-01")).toBe(10); // nothing moved

    expect((await transfer("B-02")).ok).toBe(true);
    expect(await inventory.getBalance(w, "SKU-1", "B-02")).toBe(4);

    await retireLocation("B-02");
    expect((await transfer("B-02")).ok).toBe(false); // cannot add to a retired location
    const drained = await transfer("A-01", "B-02"); // but can move stock out of it
    expect(drained.ok).toBe(true);
    expect(await inventory.getBalance(w, "SKU-1", "B-02")).toBe(0);
  });
});
