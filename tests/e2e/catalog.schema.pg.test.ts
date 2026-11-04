import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = process.env.LEDGER_DRIVER === "postgres";

/** The SQLSTATE of the error a statement raises, or undefined when it succeeds. */
async function sqlState(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const INTEGRITY_VIOLATION = "23000"; // raised by the immutability triggers

describe.skipIf(!enabled)("catalog schema (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  const uniq = () => randomUUID().slice(0, 8);

  async function uomId(code: string) {
    const { rows } = await pool.query("SELECT id FROM catalog.uom WHERE code = $1", [code]);
    return rows[0].id as string;
  }

  /** Inserts an item; returns its id and the statement so callers can inspect a failure. */
  async function addItem(sku = `SKU-${uniq()}`, extra = "") {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO catalog.item (id, sku, description, base_uom_id ${extra ? ", " + extra.split("=")[0] : ""})
       VALUES ($1, $2, 'Test item', $3 ${extra ? ", " + extra.split("=")[1] : ""})`,
      [id, sku, await uomId("EA")],
    );
    return id;
  }

  it("seeds the units of measure", async () => {
    const { rows } = await pool.query("SELECT code FROM catalog.uom");
    expect(rows.map((r) => r.code)).toEqual(expect.arrayContaining(["EA", "CS", "PL"]));
  });

  it("rejects SKUs with the wrong format", async () => {
    for (const bad of ["has space", "", "x".repeat(65)]) {
      const state = await sqlState(
        pool.query(
          "INSERT INTO catalog.item (id, sku, description, base_uom_id) VALUES ($1, $2, 'x', $3)",
          [randomUUID(), bad, await uomId("EA")],
        ),
      );
      expect(state, JSON.stringify(bad)).toBe(CHECK_VIOLATION);
    }
  });

  it("keeps SKUs unique, ignoring case", async () => {
    const sku = `Mixed-${uniq()}`;
    await addItem(sku);
    expect(await sqlState(addItem(sku.toUpperCase()))).toBe(UNIQUE_VIOLATION);
  });

  it("only allows a shelf life on an item that expires", async () => {
    expect(await sqlState(addItem(`SKU-${uniq()}`, "shelf_life_days=30"))).toBe(CHECK_VIOLATION);
    expect(await sqlState(addItem(`SKU-${uniq()}`, "has_expiry=true"))).toBeUndefined();
  });

  it("refuses to change a SKU or a base unit", async () => {
    const id = await addItem();
    expect(
      await sqlState(pool.query("UPDATE catalog.item SET sku = 'CHANGED' WHERE id = $1", [id])),
    ).toBe(INTEGRITY_VIOLATION);
    expect(
      await sqlState(
        pool.query("UPDATE catalog.item SET base_uom_id = $2 WHERE id = $1", [
          id,
          await uomId("CS"),
        ]),
      ),
    ).toBe(INTEGRITY_VIOLATION);
  });

  it("refuses to change a unit or category code", async () => {
    const uom = pool.query("UPDATE catalog.uom SET code = 'XX' WHERE code = 'EA'");
    expect(await sqlState(uom)).toBe(INTEGRITY_VIOLATION);
    const catId = randomUUID();
    await pool.query("INSERT INTO catalog.item_category (id, code, name) VALUES ($1, $2, 'c')", [
      catId,
      `CAT-${uniq()}`,
    ]);
    const cat = pool.query("UPDATE catalog.item_category SET code = 'CHANGED' WHERE id = $1", [
      catId,
    ]);
    expect(await sqlState(cat)).toBe(INTEGRITY_VIOLATION);
  });

  it("keeps an item unit's item and unit fixed, and its numbers sensible", async () => {
    const item = await addItem();
    const id = randomUUID();
    await pool.query(
      "INSERT INTO catalog.item_uom (id, item_id, uom_id, qty_in_base) VALUES ($1, $2, $3, 12)",
      [id, item, await uomId("CS")],
    );
    const move = pool.query("UPDATE catalog.item_uom SET uom_id = $2 WHERE id = $1", [
      id,
      await uomId("PL"),
    ]);
    expect(await sqlState(move)).toBe(INTEGRITY_VIOLATION);

    expect(
      await sqlState(pool.query("UPDATE catalog.item_uom SET qty_in_base = 0 WHERE id = $1", [id])),
    ).toBe(CHECK_VIOLATION);
    expect(
      await sqlState(pool.query("UPDATE catalog.item_uom SET weight = -1 WHERE id = $1", [id])),
    ).toBe(CHECK_VIOLATION);

    const twice = pool.query(
      "INSERT INTO catalog.item_uom (id, item_id, uom_id, qty_in_base) VALUES ($1, $2, $3, 6)",
      [randomUUID(), item, await uomId("CS")],
    );
    expect(await sqlState(twice)).toBe(UNIQUE_VIOLATION);
  });

  describe("barcodes", () => {
    async function unitFor(itemId: string, code = "EA") {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO catalog.item_uom (id, item_id, uom_id, qty_in_base) VALUES ($1, $2, $3, 1)",
        [id, itemId, await uomId(code)],
      );
      return id;
    }
    const addBarcode = (itemId: string, itemUomId: string, barcode: string, type = "EAN13") =>
      pool.query(
        "INSERT INTO catalog.item_barcode (id, item_id, item_uom_id, barcode, type) VALUES ($1, $2, $3, $4, $5)",
        [randomUUID(), itemId, itemUomId, barcode, type],
      );

    it("rejects barcodes with the wrong format or type", async () => {
      const item = await addItem();
      const unit = await unitFor(item);
      for (const bad of ["has space", "", "x".repeat(129), "caf\u00e9"]) {
        expect(await sqlState(addBarcode(item, unit, bad)), JSON.stringify(bad)).toBe(
          CHECK_VIOLATION,
        );
      }
      expect(await sqlState(addBarcode(item, unit, `B${uniq()}`, "WEIRD"))).toBe(CHECK_VIOLATION);
    });

    it("keeps barcodes unique, matching case exactly", async () => {
      const item = await addItem();
      const unit = await unitFor(item);
      const code = `Ab${uniq()}`;
      await addBarcode(item, unit, code);
      expect(await sqlState(addBarcode(item, unit, code))).toBe(UNIQUE_VIOLATION);
      expect(await sqlState(addBarcode(item, unit, code.toUpperCase()))).toBeUndefined();
    });

    it("refuses a unit that belongs to another item", async () => {
      const [a, b] = [await addItem(), await addItem()];
      const unitOfB = await unitFor(b);
      expect(await sqlState(addBarcode(a, unitOfB, `B${uniq()}`))).toBe("23503");
    });
  });
});
