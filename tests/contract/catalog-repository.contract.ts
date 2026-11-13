import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CatalogRepository } from "../../modules/catalog/application/ports.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/catalog/domain/errors.js";
import type {
  Item,
  ItemBarcode,
  ItemCategory,
  ItemUom,
  Uom,
} from "../../modules/catalog/domain/model.js";

type RepoFactory = () => CatalogRepository | Promise<CatalogRepository>;

const uniq = () => randomUUID().slice(0, 8);
const audit = () => ({
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  version: 1,
});

async function uomRef(repo: CatalogRepository, code = "EA") {
  const u = await repo.getUomByCode(code);
  if (!u) throw new Error(`seeded unit ${code} is missing`);
  return { id: u.id, code: u.code };
}

const category = (over: Partial<ItemCategory> = {}): ItemCategory => ({
  id: randomUUID(),
  parentId: null,
  code: `CAT-${uniq()}`,
  name: "Category",
  ...audit(),
  ...over,
});

async function item(repo: CatalogRepository, over: Partial<Item> = {}): Promise<Item> {
  return {
    id: randomUUID(),
    sku: `SKU-${uniq()}`,
    description: "A test item",
    categoryId: null,
    baseUom: await uomRef(repo),
    status: "ACTIVE",
    isLotTracked: false,
    isSerialTracked: false,
    hasExpiry: false,
    shelfLifeDays: null,
    ...audit(),
    ...over,
  };
}

async function itemUom(
  repo: CatalogRepository,
  itemId: string,
  code: string,
  qtyInBase: number,
  over: Partial<ItemUom> = {},
): Promise<ItemUom> {
  return {
    id: randomUUID(),
    itemId,
    uom: await uomRef(repo, code),
    qtyInBase,
    length: null,
    width: null,
    height: null,
    weight: null,
    ...audit(),
    ...over,
  };
}

/** Inserts an item together with its base unit (EA, quantity 1). */
async function insertWithBase(repo: CatalogRepository, over: Partial<Item> = {}) {
  const i = await item(repo, over);
  return repo.insertItem(i, [await itemUom(repo, i.id, i.baseUom.code, 1)]);
}

/**
 * The CatalogRepository contract (Implementation Plan P1-4, ADR 0004). Every adapter must pass
 * this exact suite.
 */
export function catalogRepositoryContract(
  name: string,
  factory: RepoFactory,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`CatalogRepository contract: ${name}`, () => {
    describe("units of measure", () => {
      it("starts with EA, CS and PL, looked up ignoring case", async () => {
        const repo = await factory();
        const codes = (await repo.listUoms()).map((u) => u.code);
        for (const code of ["EA", "CS", "PL"]) expect(codes).toContain(code);
        expect((await repo.getUomByCode("ea"))?.code).toBe("EA");
        expect(await repo.getUomByCode("NOPE")).toBeNull();
      });

      it("adds a unit and rejects a duplicate code, ignoring case", async () => {
        const repo = await factory();
        const u: Uom = { id: randomUUID(), code: `U-${uniq()}`, name: "Test unit", ...audit() };
        await repo.insertUom(u);
        await expect(
          repo.insertUom({ ...u, id: randomUUID(), code: u.code.toLowerCase() }),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    });

    describe("categories", () => {
      it("stores a tree and reads it back", async () => {
        const repo = await factory();
        const root = await repo.insertCategory(category());
        const child = await repo.insertCategory(category({ parentId: root.id }));
        expect(child).toMatchObject({ parentId: root.id, version: 1 });
        expect((await repo.getCategory(root.id))?.code).toBe(root.code);
        expect((await repo.getCategoryByCode(root.code.toLowerCase()))?.id).toBe(root.id);
        expect((await repo.listCategories()).map((c) => c.id)).toContain(child.id);
      });

      it("rejects an unknown parent and a duplicate code, ignoring case", async () => {
        const repo = await factory();
        await expect(
          repo.insertCategory(category({ parentId: randomUUID() })),
        ).rejects.toBeInstanceOf(RuleViolationError);
        const c = await repo.insertCategory(category());
        await expect(
          repo.insertCategory(category({ code: c.code.toUpperCase() })),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it("renames with the version check and never changes the code", async () => {
        const repo = await factory();
        const c = await repo.insertCategory(category());
        const updated = await repo.updateCategory({ ...c, name: "Renamed", code: "HACKED" }, 1);
        expect(updated).toMatchObject({ name: "Renamed", code: c.code, version: 2 });
        await expect(repo.updateCategory({ ...c, name: "Late" }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
        await expect(repo.updateCategory({ ...c, id: randomUUID() }, 1)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });

    describe("items", () => {
      it("stores an item with its base unit and finds it by its exact SKU", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo, { hasExpiry: true, shelfLifeDays: 90 });
        expect(stored).toMatchObject({
          status: "ACTIVE",
          hasExpiry: true,
          shelfLifeDays: 90,
          categoryId: null,
          version: 1,
        });
        expect(stored.baseUom.code).toBe("EA");
        expect((await repo.getItemBySku(stored.sku))?.id).toBe(stored.id);
        expect((await repo.getItem(stored.id))?.sku).toBe(stored.sku);
        const units = await repo.listItemUoms(stored.id);
        expect(units.map((u) => [u.uom.code, u.qtyInBase])).toEqual([["EA", 1]]);
      });

      it("matches the SKU exactly: a different case finds nothing", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo, { sku: `Sku-${uniq()}` });
        expect(await repo.getItemBySku(stored.sku.toUpperCase())).toBeNull();
        expect(await repo.getItemBySku("NOPE")).toBeNull();
        expect(await repo.getItem(randomUUID())).toBeNull();
      });

      it("rejects a duplicate SKU, ignoring case", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo, { sku: `Dup-${uniq()}` });
        await expect(
          insertWithBase(repo, { sku: stored.sku.toUpperCase() }),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it("rejects an unknown base unit or category", async () => {
        const repo = await factory();
        await expect(
          repo.insertItem(await item(repo, { baseUom: { id: randomUUID(), code: "XX" } }), []),
        ).rejects.toBeInstanceOf(RuleViolationError);
        await expect(
          repo.insertItem(await item(repo, { categoryId: randomUUID() }), []),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("stores nothing when one of its units is invalid", async () => {
        const repo = await factory();
        const i = await item(repo);
        const bad = await itemUom(repo, i.id, "EA", 1, { uom: { id: randomUUID(), code: "XX" } });
        await expect(repo.insertItem(i, [bad])).rejects.toBeInstanceOf(RuleViolationError);
        expect(await repo.getItemBySku(i.sku)).toBeNull();
      });

      it("updates the mutable fields and never the SKU or base unit", async () => {
        const repo = await factory();
        const cat = await repo.insertCategory(category());
        const stored = await insertWithBase(repo);
        const updated = await repo.updateItem(
          {
            ...stored,
            description: "New description",
            categoryId: cat.id,
            status: "INACTIVE",
            isLotTracked: true,
            isSerialTracked: true,
            hasExpiry: true,
            shelfLifeDays: 30,
            sku: "HACKED",
            baseUom: await uomRef(repo, "PL"),
          },
          1,
        );
        expect(updated).toMatchObject({
          sku: stored.sku,
          description: "New description",
          categoryId: cat.id,
          status: "INACTIVE",
          isLotTracked: true,
          isSerialTracked: true,
          hasExpiry: true,
          shelfLifeDays: 30,
          version: 2,
        });
        expect(updated.baseUom.code).toBe("EA");
      });

      it("rejects a stale version, an unknown item and an unknown category on update", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo);
        await repo.updateItem({ ...stored, description: "First" }, 1);
        await expect(repo.updateItem({ ...stored, description: "Late" }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
        await expect(repo.updateItem({ ...stored, id: randomUUID() }, 1)).rejects.toBeInstanceOf(
          NotFoundError,
        );
        await expect(
          repo.updateItem({ ...stored, categoryId: randomUUID() }, 2),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("lists in SKU order with keyset pagination and filters", async () => {
        const repo = await factory();
        const cat = await repo.insertCategory(category());
        const prefix = `LST-${uniq()}`;
        for (const n of ["3", "1", "2"]) {
          await insertWithBase(repo, { sku: `${prefix}-${n}`, categoryId: cat.id });
        }
        const inactive = await insertWithBase(repo, { sku: `${prefix}-4`, categoryId: cat.id });
        await repo.updateItem({ ...inactive, status: "INACTIVE" }, 1);

        const skus = async (f: Parameters<CatalogRepository["listItems"]>[0]) =>
          (await repo.listItems({ categoryId: cat.id, ...f })).items.map((i) => i.sku);

        expect(await skus({ limit: 50 })).toEqual([1, 2, 3, 4].map((n) => `${prefix}-${n}`));
        expect(await skus({ limit: 50, status: "INACTIVE" })).toEqual([`${prefix}-4`]);

        const page1 = await repo.listItems({ categoryId: cat.id, limit: 2 });
        expect(page1.items.map((i) => i.sku)).toEqual([`${prefix}-1`, `${prefix}-2`]);
        expect(page1.nextAfter).toBe(`${prefix}-2`);
        const page2 = await repo.listItems({
          categoryId: cat.id,
          limit: 2,
          after: page1.nextAfter ?? "",
        });
        expect(page2.items.map((i) => i.sku)).toEqual([`${prefix}-3`, `${prefix}-4`]);
        expect(page2.nextAfter).toBeNull();
      });
    });

    describe("item units", () => {
      it("adds a unit with dimensions and lists the units by unit code", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo);
        const cs = await repo.addItemUom(
          await itemUom(repo, stored.id, "CS", 12, {
            length: 30,
            width: 20.5,
            height: 15,
            weight: 4.25,
          }),
        );
        expect(cs).toMatchObject({
          qtyInBase: 12,
          length: 30,
          width: 20.5,
          height: 15,
          weight: 4.25,
          version: 1,
        });
        const units = await repo.listItemUoms(stored.id);
        expect(units.map((u) => [u.uom.code, u.qtyInBase])).toEqual([
          ["CS", 12],
          ["EA", 1],
        ]);
      });

      it("rejects a unit twice for one item, and an unknown item or unit", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo);
        await expect(
          repo.addItemUom(await itemUom(repo, stored.id, "EA", 1)),
        ).rejects.toBeInstanceOf(ConflictError);
        await expect(
          repo.addItemUom(await itemUom(repo, randomUUID(), "CS", 12)),
        ).rejects.toBeInstanceOf(RuleViolationError);
        await expect(
          repo.addItemUom(
            await itemUom(repo, stored.id, "CS", 12, { uom: { id: randomUUID(), code: "XX" } }),
          ),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("updates quantity and dimensions with the version check", async () => {
        const repo = await factory();
        const stored = await insertWithBase(repo);
        const cs = await repo.addItemUom(await itemUom(repo, stored.id, "CS", 12));
        const updated = await repo.updateItemUom(
          { ...cs, qtyInBase: 24, weight: 9.5, uom: await uomRef(repo, "PL") },
          1,
        );
        expect(updated).toMatchObject({ qtyInBase: 24, weight: 9.5, version: 2 });
        expect(updated.uom.code).toBe("CS"); // which unit it is never changes
        await expect(repo.updateItemUom({ ...cs, qtyInBase: 6 }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
        await expect(repo.updateItemUom({ ...cs, id: randomUUID() }, 1)).rejects.toBeInstanceOf(
          NotFoundError,
        );
      });
    });

    describe("barcodes", () => {
      /** An item with its base unit (EA) and a case unit (CS, 12 each). */
      async function itemWithCase(repo: CatalogRepository) {
        const stored = await insertWithBase(repo);
        const cs = await repo.addItemUom(await itemUom(repo, stored.id, "CS", 12));
        const [ea] = await repo.listItemUoms(stored.id);
        return { stored, cs, ea: ea as ItemUom };
      }
      const barcode = (itemId: string, itemUomId: string, code = `B${uniq()}`): ItemBarcode => ({
        id: randomUUID(),
        itemId,
        itemUomId,
        barcode: code,
        type: "EAN13",
        createdAt: new Date(),
        createdBy: null,
      });

      it("adds barcodes to an item unit and lists them in order", async () => {
        const repo = await factory();
        const { stored, cs, ea } = await itemWithCase(repo);
        const prefix = `ORDER-${uniq()}-`;
        const first = `${prefix}1111`;
        const second = `${prefix}9999`;
        await repo.addBarcode(barcode(stored.id, cs.id, second));
        await repo.addBarcode(barcode(stored.id, ea.id, first));
        const listed = await repo.listBarcodes(stored.id);
        expect(listed.map((b) => b.barcode)).toEqual([first, second]);
        expect(listed[1]).toMatchObject({ itemId: stored.id, itemUomId: cs.id, type: "EAN13" });
      });

      it("resolves a barcode to its item and the unit it identifies", async () => {
        const repo = await factory();
        const { stored, cs } = await itemWithCase(repo);
        const code = `CASE${uniq()}`;
        await repo.addBarcode(barcode(stored.id, cs.id, code));
        const resolved = await repo.resolveBarcode(code);
        expect(resolved?.item.id).toBe(stored.id);
        expect(resolved?.itemUom).toMatchObject({ id: cs.id, qtyInBase: 12 });
        expect(resolved?.itemUom.uom.code).toBe("CS");
        expect(resolved?.barcode.barcode).toBe(code);
      });

      it("matches exactly: another case or an unknown barcode finds nothing", async () => {
        const repo = await factory();
        const { stored, ea } = await itemWithCase(repo);
        const code = `Ab${uniq()}`;
        await repo.addBarcode(barcode(stored.id, ea.id, code));
        expect(await repo.resolveBarcode(code.toUpperCase())).toBeNull();
        expect(await repo.resolveBarcode("NOPE-NOT-A-BARCODE")).toBeNull();
      });

      it("rejects a barcode that already exists, even on another item", async () => {
        const repo = await factory();
        const a = await itemWithCase(repo);
        const b = await itemWithCase(repo);
        const code = `DUP${uniq()}`;
        await repo.addBarcode(barcode(a.stored.id, a.ea.id, code));
        await expect(repo.addBarcode(barcode(b.stored.id, b.ea.id, code))).rejects.toBeInstanceOf(
          ConflictError,
        );
      });

      it("rejects an unknown item, an unknown unit, and a unit of another item", async () => {
        const repo = await factory();
        const a = await itemWithCase(repo);
        const b = await itemWithCase(repo);
        await expect(repo.addBarcode(barcode(randomUUID(), a.ea.id))).rejects.toBeInstanceOf(
          RuleViolationError,
        );
        await expect(repo.addBarcode(barcode(a.stored.id, randomUUID()))).rejects.toBeInstanceOf(
          RuleViolationError,
        );
        await expect(repo.addBarcode(barcode(a.stored.id, b.ea.id))).rejects.toBeInstanceOf(
          RuleViolationError,
        );
      });

      it("deletes a barcode, after which it no longer resolves", async () => {
        const repo = await factory();
        const { stored, ea } = await itemWithCase(repo);
        const b = await repo.addBarcode(barcode(stored.id, ea.id));
        await repo.deleteBarcode(b.id);
        expect(await repo.resolveBarcode(b.barcode)).toBeNull();
        expect(await repo.listBarcodes(stored.id)).toEqual([]);
        await expect(repo.deleteBarcode(b.id)).rejects.toBeInstanceOf(NotFoundError);
      });
    });
  });
}
