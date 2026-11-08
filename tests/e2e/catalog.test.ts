import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import { createCatalogModule } from "../../modules/catalog/index.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/catalog/domain/errors.js";

const uniq = () => randomUUID().slice(0, 8);

/** Unwraps a Result, failing the test with the module's own error when it is an error. */
function must<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** Asserts a Result is an error of the given class. */
function expectError(
  result: Result<unknown, Error>,
  kind: new (...args: never[]) => Error,
  label = "",
) {
  expect(result.ok, label).toBe(false);
  if (!result.ok) expect(result.error, label).toBeInstanceOf(kind);
}

const setup = () => createCatalogModule();

describe("items", () => {
  it("creates an item with its base unit, one each, automatically", async () => {
    const m = setup();
    const { item, units } = must(
      await m.items.create({ sku: "WIDGET-1", description: "  Widget  ", baseUom: "EA" }),
    );
    expect(item).toMatchObject({
      sku: "WIDGET-1",
      description: "Widget",
      status: "ACTIVE",
      isLotTracked: false,
      hasExpiry: false,
      shelfLifeDays: null,
      categoryCode: null,
      version: 1,
    });
    expect(item.baseUom.code).toBe("EA");
    expect(units.map((u) => [u.uom.code, u.qtyInBase])).toEqual([["EA", 1]]);
  });

  it("creates an item with a category, expiry, extra units and dimensions", async () => {
    const m = setup();
    must(await m.categories.create({ code: "FOOD", name: "Food" }));
    const { item, units } = must(
      await m.items.create({
        sku: "JAM-1",
        description: "Strawberry jam",
        baseUom: "EA",
        category: "food",
        isLotTracked: true,
        hasExpiry: true,
        shelfLifeDays: 365,
        units: [
          { uom: "EA", weight: 0.4 },
          { uom: "CS", qtyInBase: 12, length: 30, width: 20, height: 15, weight: 5.2 },
        ],
      }),
    );
    expect(item).toMatchObject({
      categoryCode: "FOOD",
      isLotTracked: true,
      hasExpiry: true,
      shelfLifeDays: 365,
    });
    expect(units.map((u) => [u.uom.code, u.qtyInBase, u.weight])).toEqual([
      ["CS", 12, 5.2],
      ["EA", 1, 0.4],
    ]);
  });

  it("enforces its rules on creation", async () => {
    const m = setup();
    const base = { sku: "OK-1", description: "Fine", baseUom: "EA" };
    const cases: [string, Parameters<typeof m.items.create>[0]][] = [
      ["an invalid SKU", { ...base, sku: "bad sku" }],
      ["a blank description", { ...base, description: "   " }],
      ["an unknown base unit", { ...base, baseUom: "NOPE" }],
      ["an unknown category", { ...base, category: "NOPE" }],
      ["a shelf life without expiry", { ...base, shelfLifeDays: 30 }],
      ["a zero shelf life", { ...base, hasExpiry: true, shelfLifeDays: 0 }],
      ["an unknown extra unit", { ...base, units: [{ uom: "NOPE", qtyInBase: 2 }] }],
      [
        "a unit listed twice",
        {
          ...base,
          units: [
            { uom: "CS", qtyInBase: 2 },
            { uom: "cs", qtyInBase: 3 },
          ],
        },
      ],
      ["a unit without a quantity", { ...base, units: [{ uom: "CS" }] }],
      ["a fractional quantity", { ...base, units: [{ uom: "CS", qtyInBase: 1.5 }] }],
      ["a zero quantity", { ...base, units: [{ uom: "CS", qtyInBase: 0 }] }],
      ["a base unit that is not one", { ...base, units: [{ uom: "EA", qtyInBase: 2 }] }],
      ["a negative dimension", { ...base, units: [{ uom: "CS", qtyInBase: 2, weight: -1 }] }],
    ];
    for (const [label, input] of cases)
      expectError(await m.items.create(input), RuleViolationError, label);
    must(await m.items.create(base)); // the catalog still works
  });

  it("refuses a duplicate SKU, ignoring case", async () => {
    const m = setup();
    must(await m.items.create({ sku: "Dup-1", description: "First", baseUom: "EA" }));
    expectError(
      await m.items.create({ sku: "DUP-1", description: "Second", baseUom: "EA" }),
      ConflictError,
    );
  });

  it("reads an item by its exact SKU", async () => {
    const m = setup();
    must(await m.items.create({ sku: "Abc-1", description: "x", baseUom: "EA" }));
    expect(must(await m.items.get("Abc-1")).item.sku).toBe("Abc-1");
    expectError(await m.items.get("abc-1"), NotFoundError);
  });

  it("updates with the current version and refuses a stale one", async () => {
    const m = setup();
    must(await m.categories.create({ code: "C1", name: "One" }));
    must(await m.items.create({ sku: "U-1", description: "Old", baseUom: "EA", hasExpiry: true }));

    const { item } = must(
      await m.items.update("U-1", {
        version: 1,
        description: "New",
        category: "C1",
        status: "INACTIVE",
        shelfLifeDays: 90,
      }),
    );
    expect(item).toMatchObject({
      description: "New",
      categoryCode: "C1",
      status: "INACTIVE",
      shelfLifeDays: 90,
      version: 2,
    });

    expectError(await m.items.update("U-1", { version: 1, description: "Late" }), ConflictError);
    expectError(await m.items.update("MISSING", { version: 1, description: "x" }), NotFoundError);
    expect(
      must(await m.items.update("U-1", { version: 2, category: null })).item.categoryCode,
    ).toBeNull();
  });

  it("refuses a shelf life on an item that does not expire, and an unknown category", async () => {
    const m = setup();
    must(await m.items.create({ sku: "N-1", description: "No expiry", baseUom: "EA" }));
    expectError(await m.items.update("N-1", { version: 1, shelfLifeDays: 30 }), RuleViolationError);
    expectError(await m.items.update("N-1", { version: 1, category: "NOPE" }), RuleViolationError);
  });

  it("lists with filters and keyset pagination", async () => {
    const m = setup();
    must(await m.categories.create({ code: "LISTCAT", name: "List" }));
    const prefix = `L${uniq()}`;
    for (const n of ["3", "1", "2"]) {
      must(
        await m.items.create({
          sku: `${prefix}-${n}`,
          description: "x",
          baseUom: "EA",
          category: "LISTCAT",
        }),
      );
    }
    must(await m.items.update(`${prefix}-2`, { version: 1, status: "INACTIVE" }));

    const first = must(await m.items.list({ category: "LISTCAT", limit: 2 }));
    expect(first.items.map((i) => i.sku)).toEqual([`${prefix}-1`, `${prefix}-2`]);
    expect(first.items[0]?.categoryCode).toBe("LISTCAT");
    expect(first.nextAfter).toBe(`${prefix}-2`);

    const rest = must(
      await m.items.list({ category: "LISTCAT", limit: 2, after: first.nextAfter ?? "" }),
    );
    expect(rest.items.map((i) => i.sku)).toEqual([`${prefix}-3`]);
    expect(rest.nextAfter).toBeNull();

    const inactive = must(
      await m.items.list({ category: "LISTCAT", status: "INACTIVE", limit: 50 }),
    );
    expect(inactive.items.map((i) => i.sku)).toEqual([`${prefix}-2`]);

    expectError(await m.items.list({ category: "NOPE", limit: 10 }), RuleViolationError);
  });
});

describe("item units", () => {
  async function withItem() {
    const m = setup();
    must(await m.items.create({ sku: "P-1", description: "Packed", baseUom: "EA" }));
    return m;
  }

  it("adds a unit with dimensions and lists the units", async () => {
    const m = await withItem();
    const cs = must(await m.items.addUnit("P-1", { uom: "CS", qtyInBase: 12, weight: 4.5 }));
    expect(cs).toMatchObject({ qtyInBase: 12, weight: 4.5, version: 1 });
    expect(must(await m.items.listUnits("P-1")).map((u) => [u.uom.code, u.qtyInBase])).toEqual([
      ["CS", 12],
      ["EA", 1],
    ]);
  });

  it("refuses a duplicate unit, an unknown unit or item, and a bad quantity", async () => {
    const m = await withItem();
    must(await m.items.addUnit("P-1", { uom: "CS", qtyInBase: 12 }));
    expectError(await m.items.addUnit("P-1", { uom: "CS", qtyInBase: 6 }), ConflictError);
    expectError(await m.items.addUnit("P-1", { uom: "EA", qtyInBase: 1 }), ConflictError); // the base unit exists
    expectError(await m.items.addUnit("P-1", { uom: "NOPE", qtyInBase: 2 }), RuleViolationError);
    expectError(await m.items.addUnit("MISSING", { uom: "PL", qtyInBase: 2 }), NotFoundError);
    expectError(await m.items.addUnit("P-1", { uom: "PL", qtyInBase: 0 }), RuleViolationError);
  });

  it("updates a unit with the version, keeping the base unit at one", async () => {
    const m = await withItem();
    must(await m.items.addUnit("P-1", { uom: "CS", qtyInBase: 12 }));
    const updated = must(
      await m.items.updateUnit("P-1", "cs", { version: 1, qtyInBase: 24, weight: 9 }),
    );
    expect(updated).toMatchObject({ qtyInBase: 24, weight: 9, version: 2 });

    expectError(await m.items.updateUnit("P-1", "CS", { version: 1, qtyInBase: 6 }), ConflictError);
    expectError(
      await m.items.updateUnit("P-1", "EA", { version: 1, qtyInBase: 2 }),
      RuleViolationError,
    );
    must(await m.items.updateUnit("P-1", "EA", { version: 1, weight: 0.3 })); // dimensions are fine
    expectError(await m.items.updateUnit("P-1", "PL", { version: 1, weight: 1 }), NotFoundError);
  });
});

describe("categories and units of measure", () => {
  it("creates a tree, refuses duplicates and unknown parents, and renames", async () => {
    const m = setup();
    must(await m.categories.create({ code: "ROOT", name: "Root" }));
    const child = must(await m.categories.create({ code: "KID", name: "Child", parent: "root" }));
    expect(child.parentCode).toBe("ROOT");
    expectError(await m.categories.create({ code: "root", name: "Again" }), ConflictError);
    expectError(
      await m.categories.create({ code: "X", name: "x", parent: "NOPE" }),
      RuleViolationError,
    );

    const renamed = must(await m.categories.rename("KID", { version: 1, name: "Renamed" }));
    expect(renamed).toMatchObject({ name: "Renamed", parentCode: "ROOT", version: 2 });
    expectError(await m.categories.rename("KID", { version: 1, name: "Late" }), ConflictError);
    expectError(await m.categories.rename("NOPE", { version: 1, name: "x" }), NotFoundError);

    const listed = await m.categories.list();
    expect(listed.find((c) => c.code === "KID")?.parentCode).toBe("ROOT");
  });

  it("lists the seeded units, and a new unit can be a base unit straight away", async () => {
    const m = setup();
    expect((await m.uoms.list()).map((u) => u.code)).toEqual(
      expect.arrayContaining(["EA", "CS", "PL"]),
    );
    must(await m.uoms.create({ code: "KG", name: "Kilogram" }));
    expectError(await m.uoms.create({ code: "kg", name: "Again" }), ConflictError);
    const { item } = must(
      await m.items.create({ sku: "FLOUR-1", description: "Flour", baseUom: "kg" }),
    );
    expect(item.baseUom.code).toBe("KG");
  });
});
