import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import { createLocationsModule } from "../../modules/locations/index.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/locations/domain/errors.js";

const uniq = () => randomUUID().slice(0, 8);

/** Unwraps a Result, failing the test with the module's own error when it is an error. */
function must<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function setup() {
  const m = createLocationsModule();
  const newWarehouse = async (code = `WH-${uniq()}`) =>
    must(await m.warehouses.create({ code, name: "Main warehouse" }));
  const newLocation = async (warehouseId: string, code: string, extra = {}) =>
    must(await m.locations.create(warehouseId, { code, type: "BIN", ...extra }));
  return { m, newWarehouse, newLocation };
}

describe("warehouses", () => {
  it("creates a warehouse that is active, UTC by default, at version 1", async () => {
    const { m } = setup();
    const w = must(await m.warehouses.create({ code: "MAIN", name: "  Main warehouse  " }));
    expect(w).toMatchObject({
      code: "MAIN",
      name: "Main warehouse",
      timezone: "UTC",
      status: "ACTIVE",
      address: null,
      version: 1,
    });
  });

  it("rejects an invalid code, a blank name and an unknown time zone", async () => {
    const { m } = setup();
    for (const input of [
      { code: "has space", name: "x" },
      { code: "ok", name: "   " },
      { code: "ok", name: "x", timezone: "Mars/Olympus" },
    ]) {
      const r = await m.warehouses.create(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeInstanceOf(RuleViolationError);
    }
  });

  it("accepts a real IANA time zone", async () => {
    const { m } = setup();
    const w = must(
      await m.warehouses.create({ code: "CAI", name: "Cairo", timezone: "Africa/Cairo" }),
    );
    expect(w.timezone).toBe("Africa/Cairo");
  });

  it("rejects a duplicate code, ignoring case", async () => {
    const { m, newWarehouse } = setup();
    await newWarehouse("Main");
    const r = await m.warehouses.create({ code: "MAIN", name: "Again" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ConflictError);
  });

  it("updates with the current version and refuses a stale one", async () => {
    const { m, newWarehouse } = setup();
    const w = await newWarehouse();
    const updated = must(await m.warehouses.update(w.id, { version: 1, name: "Renamed" }));
    expect(updated).toMatchObject({ name: "Renamed", version: 2 });

    const stale = await m.warehouses.update(w.id, { version: 1, name: "Too late" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBeInstanceOf(ConflictError);
  });

  it("answers not found for an unknown warehouse", async () => {
    const { m } = setup();
    const r = await m.warehouses.update(randomUUID(), { version: 1, name: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(NotFoundError);
  });
});

describe("zones", () => {
  it("creates zones inside a warehouse and lists them", async () => {
    const { m, newWarehouse } = setup();
    const w = await newWarehouse();
    const z = must(await m.zones.create(w.id, { code: "PICK-1", type: "PICKING" }));
    expect(z).toMatchObject({ warehouseId: w.id, code: "PICK-1", type: "PICKING", isActive: true });
    expect(must(await m.zones.list(w.id)).map((x) => x.code)).toEqual(["PICK-1"]);
  });

  it("answers not found for an unknown warehouse and rejects an unknown type", async () => {
    const { m, newWarehouse } = setup();
    const missing = await m.zones.create(randomUUID(), { code: "Z", type: "STORAGE" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBeInstanceOf(NotFoundError);

    const w = await newWarehouse();
    const bad = await m.zones.create(w.id, { code: "Z", type: "NOPE" as never });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeInstanceOf(RuleViolationError);
  });
});

describe("locations", () => {
  it("creates a location with zone, type, capacity and storage classes", async () => {
    const { m, newWarehouse } = setup();
    const w = await newWarehouse();
    const z = must(await m.zones.create(w.id, { code: "PICK", type: "PICKING" }));

    const l = must(
      await m.locations.create(w.id, {
        code: "A-01-02",
        zoneId: z.id,
        type: "BIN",
        aisle: "A",
        bay: "01",
        level: "02",
        capacity: { maxUnits: 200, maxWeight: 35.5 },
        storageClasses: ["COLD", "AMBIENT"],
      }),
    );

    expect(l).toMatchObject({
      warehouseId: w.id,
      zoneId: z.id,
      code: "A-01-02",
      aisle: "A",
      status: "AVAILABLE",
      isActive: true,
      version: 1,
      capacity: { maxUnits: 200, maxWeight: 35.5, maxVolume: null, maxLpns: null },
    });
    expect(l.type.code).toBe("BIN");
    expect(l.storageClasses.map((c) => c.code)).toEqual(["AMBIENT", "COLD"]);
  });

  it("lets two warehouses both have an A-01, but not one warehouse twice", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const [w1, w2] = [await newWarehouse(), await newWarehouse()];
    await newLocation(w1.id, "A-01");
    await newLocation(w2.id, "A-01");

    const duplicate = await m.locations.create(w1.id, { code: "a-01", type: "BIN" });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toBeInstanceOf(ConflictError);
  });

  it("enforces its rules", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const [w1, w2] = [await newWarehouse(), await newWarehouse()];
    const foreignZone = must(await m.zones.create(w2.id, { code: "Z", type: "STORAGE" }));
    const inactiveZone = must(await m.zones.create(w1.id, { code: "OLD", type: "STORAGE" }));
    must(await m.zones.update(w1.id, inactiveZone.id, { version: 1, isActive: false }));

    const cases: [string, Parameters<typeof m.locations.create>[1]][] = [
      ["a zone from another warehouse", { code: "L1", type: "BIN", zoneId: foreignZone.id }],
      ["an inactive zone", { code: "L2", type: "BIN", zoneId: inactiveZone.id }],
      ["an unknown type", { code: "L3", type: "NOPE" }],
      ["an unknown storage class", { code: "L4", type: "BIN", storageClasses: ["LAVA"] }],
      ["a negative capacity", { code: "L5", type: "BIN", capacity: { maxUnits: -1 } }],
      ["a fractional unit capacity", { code: "L6", type: "BIN", capacity: { maxUnits: 1.5 } }],
      ["an invalid code", { code: "bad code", type: "BIN" }],
      ["an over-long aisle", { code: "L7", type: "BIN", aisle: "x".repeat(33) }],
    ];
    for (const [label, input] of cases) {
      const r = await m.locations.create(w1.id, input);
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.error, label).toBeInstanceOf(RuleViolationError);
    }
    await newLocation(w1.id, "FINE"); // the warehouse still works
  });

  it("refuses new locations in an inactive warehouse, and in an unknown one", async () => {
    const { m, newWarehouse } = setup();
    const w = await newWarehouse();
    must(await m.warehouses.update(w.id, { version: 1, status: "INACTIVE" }));

    const inactive = await m.locations.create(w.id, { code: "A-01", type: "BIN" });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) expect(inactive.error).toBeInstanceOf(RuleViolationError);

    const unknown = await m.locations.create(randomUUID(), { code: "A-01", type: "BIN" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBeInstanceOf(NotFoundError);
  });

  it("updates fields, clears the zone and capacity, and replaces storage classes", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    const z = must(await m.zones.create(w.id, { code: "Z", type: "STORAGE" }));
    await newLocation(w.id, "A-01", {
      zoneId: z.id,
      capacity: { maxUnits: 10 },
      storageClasses: ["AMBIENT"],
    });

    const updated = must(
      await m.locations.update(w.id, "A-01", {
        version: 1,
        zoneId: null,
        type: "PALLET",
        status: "BLOCKED",
        capacity: null,
        storageClasses: ["FROZEN"],
      }),
    );

    expect(updated).toMatchObject({ zoneId: null, status: "BLOCKED", capacity: null, version: 2 });
    expect(updated.type.code).toBe("PALLET");
    expect(updated.storageClasses.map((c) => c.code)).toEqual(["FROZEN"]);
  });

  it("refuses a stale version and an unknown location on update", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    await newLocation(w.id, "A-01");
    must(await m.locations.update(w.id, "A-01", { version: 1, aisle: "A" }));

    const stale = await m.locations.update(w.id, "A-01", { version: 1, aisle: "B" });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toBeInstanceOf(ConflictError);

    const missing = await m.locations.update(w.id, "NOPE", { version: 1, aisle: "B" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBeInstanceOf(NotFoundError);
  });

  it("lists with filters and keyset pagination", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    for (const code of ["L-1", "L-2", "L-3"]) await newLocation(w.id, code);
    must(await m.locations.update(w.id, "L-2", { version: 1, isActive: false }));

    const first = must(await m.locations.list(w.id, { limit: 2 }));
    expect(first.items.map((l) => l.code)).toEqual(["L-1", "L-2"]);
    expect(first.nextAfter).toBe("L-2");

    const rest = must(await m.locations.list(w.id, { limit: 2, after: "L-2" }));
    expect(rest.items.map((l) => l.code)).toEqual(["L-3"]);
    expect(rest.nextAfter).toBeNull();

    const active = must(await m.locations.list(w.id, { limit: 50, isActive: true }));
    expect(active.items.map((l) => l.code)).toEqual(["L-1", "L-3"]);

    const unknown = await m.locations.list(randomUUID(), { limit: 10 });
    expect(unknown.ok).toBe(false);
  });
});

describe("public queries (used by inventory in P1-5)", () => {
  it("getWarehouse returns a small view, or null", async () => {
    const { m, newWarehouse } = setup();
    const w = await newWarehouse("CAI");
    expect(await m.getWarehouse(w.id)).toEqual({
      id: w.id,
      code: "CAI",
      name: "Main warehouse",
      timezone: "UTC",
      isActive: true,
    });
    expect(await m.getWarehouse(randomUUID())).toBeNull();
  });

  it("getLocation matches the code exactly and describes the type", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    await newLocation(w.id, "A-01");
    expect(await m.getLocation(w.id, "A-01")).toMatchObject({
      warehouseId: w.id,
      code: "A-01",
      type: "BIN",
      isPickable: true,
      isStorable: true,
      isStaging: false,
      status: "AVAILABLE",
      isActive: true,
    });
    expect(await m.getLocation(w.id, "a-01")).toBeNull();
  });

  it("exists is true only for an active location in an active warehouse", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    await newLocation(w.id, "A-01");
    expect(await m.exists(w.id, "A-01")).toBe(true);
    expect(await m.exists(w.id, "B-99")).toBe(false);
    expect(await m.exists(randomUUID(), "A-01")).toBe(false);

    // A retired location still resolves, but no longer counts as existing.
    must(await m.locations.update(w.id, "A-01", { version: 1, isActive: false }));
    expect(await m.exists(w.id, "A-01")).toBe(false);
    expect((await m.getLocation(w.id, "A-01"))?.isActive).toBe(false);
  });

  it("exists is false for every location of an inactive warehouse", async () => {
    const { m, newWarehouse, newLocation } = setup();
    const w = await newWarehouse();
    await newLocation(w.id, "A-01");
    must(await m.warehouses.update(w.id, { version: 1, status: "INACTIVE" }));
    expect(await m.exists(w.id, "A-01")).toBe(false);
    expect((await m.getWarehouse(w.id))?.isActive).toBe(false);
  });
});

describe("reference data", () => {
  it("a new type and storage class can be used straight away", async () => {
    const { m, newWarehouse } = setup();
    must(
      await m.referenceData.createLocationType({
        code: "SHELF",
        name: "Open shelf",
        isPickable: true,
        isStorable: true,
      }),
    );
    must(await m.referenceData.createStorageClass({ code: "CHILLED", name: "Chilled" }));
    const w = await newWarehouse();
    const l = must(
      await m.locations.create(w.id, { code: "S-1", type: "shelf", storageClasses: ["chilled"] }),
    );
    expect(l.type.code).toBe("SHELF");
    expect(l.storageClasses.map((c) => c.code)).toEqual(["CHILLED"]);
  });

  it("refuses a duplicate type code, ignoring case", async () => {
    const { m } = setup();
    const r = await m.referenceData.createLocationType({ code: "bin", name: "Another bin" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeInstanceOf(ConflictError);
  });
});
