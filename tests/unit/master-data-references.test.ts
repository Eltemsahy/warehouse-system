import { describe, expect, it } from "vitest";
import { MasterDataReferences } from "../../modules/inventory/infrastructure/master-data-references.js";

type Flag = { isActive: boolean } | null;

/** Directories with a fixed answer for each lookup. */
const refs = (o: { warehouse: Flag; location: Flag; item: Flag }) =>
  new MasterDataReferences(
    { getWarehouse: async () => o.warehouse, getLocation: async () => o.location },
    { getItem: async () => o.item },
  );

const active = { isActive: true };
const retired = { isActive: false };
const check = (r: MasterDataReferences, direction: "IN" | "OUT") =>
  r.problem("w", "SKU-1", "A-01", direction);

describe("MasterDataReferences", () => {
  it("accepts stock for active master data, both ways", async () => {
    const r = refs({ warehouse: active, location: active, item: active });
    expect(await check(r, "IN")).toBeUndefined();
    expect(await check(r, "OUT")).toBeUndefined();
  });

  it("rejects an unknown warehouse, location or SKU, both ways", async () => {
    for (const direction of ["IN", "OUT"] as const) {
      expect(
        await check(refs({ warehouse: null, location: active, item: active }), direction),
      ).toContain("warehouse");
      expect(
        await check(refs({ warehouse: active, location: null, item: active }), direction),
      ).toContain("A-01");
      expect(
        await check(refs({ warehouse: active, location: active, item: null }), direction),
      ).toContain("SKU-1");
    }
  });

  it("rejects adding stock to an inactive warehouse, location or SKU", async () => {
    expect(
      await check(refs({ warehouse: retired, location: active, item: active }), "IN"),
    ).toContain("warehouse");
    expect(
      await check(refs({ warehouse: active, location: retired, item: active }), "IN"),
    ).toContain("A-01");
    expect(
      await check(refs({ warehouse: active, location: active, item: retired }), "IN"),
    ).toContain("SKU-1");
  });

  it("lets stock leave an inactive warehouse, location or SKU", async () => {
    expect(
      await check(refs({ warehouse: retired, location: active, item: active }), "OUT"),
    ).toBeUndefined();
    expect(
      await check(refs({ warehouse: active, location: retired, item: active }), "OUT"),
    ).toBeUndefined();
    expect(
      await check(refs({ warehouse: active, location: active, item: retired }), "OUT"),
    ).toBeUndefined();
    expect(
      await check(refs({ warehouse: retired, location: retired, item: retired }), "OUT"),
    ).toBeUndefined();
  });
});
