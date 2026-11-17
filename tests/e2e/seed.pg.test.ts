import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createCatalogModule, PgCatalogRepository } from "../../modules/catalog/index.js";
import {
  createInventoryModule,
  MasterDataReferences,
  PgLedgerAuditor,
  PgStockLedger,
} from "../../modules/inventory/index.js";
import { createLocationsModule, PgLocationsRepository } from "../../modules/locations/index.js";

const enabled = process.env.LEDGER_DRIVER === "postgres";

const DEMO = "00000000-0000-0000-0000-000000000001";
const WIDGET_CASE_BARCODE = "12000000000036"; // ITF-14 for a case of 24 widgets, as in the seed

describe.skipIf(!enabled)("dev seed (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  /** Runs the seed the way `npm run seed` does: in one transaction. */
  async function seed() {
    // Read here, not when the suite is set up, so the file is only needed when this really runs.
    const sql = readFileSync(new URL("../../db/seeds/dev.sql", import.meta.url), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async function counts() {
    const { rows } = await pool.query(
      `SELECT (SELECT count(*) FROM locations.zone WHERE warehouse_id = $1) AS zones,
              (SELECT count(*) FROM locations.location WHERE warehouse_id = $1) AS locations,
              (SELECT count(*) FROM catalog.item
                WHERE sku IN ('SKU-1', 'WIDGET-100', 'JAM-200', 'WATER-300', 'BOLT-400')) AS items,
              (SELECT count(*) FROM catalog.item_uom iu JOIN catalog.item i ON i.id = iu.item_id
                WHERE i.sku IN ('SKU-1', 'WIDGET-100', 'JAM-200', 'WATER-300', 'BOLT-400')) AS units,
              (SELECT count(*) FROM catalog.item_barcode WHERE barcode LIKE '200000000%' OR barcode LIKE '120000000%') AS barcodes,
              (SELECT count(*) FROM inventory.stock_levels
                WHERE warehouse_id = $1 AND sku IN ('WIDGET-100', 'JAM-200', 'WATER-300', 'BOLT-400')) AS stock_rows,
              (SELECT count(*) FROM inventory.stock_movements
                WHERE warehouse_id = $1 AND reason = 'dev seed') AS seed_movements`,
      [DEMO],
    );
    return rows[0];
  }

  const locations = createLocationsModule({ repository: new PgLocationsRepository(pool) });
  const catalog = createCatalogModule({ repository: new PgCatalogRepository(pool) });
  const inventory = createInventoryModule({
    ledger: new PgStockLedger(pool),
    references: new MasterDataReferences(locations, catalog),
  });

  it("can be run twice without adding or changing anything", async () => {
    await seed();
    const first = await counts();
    await seed();
    expect(await counts()).toEqual(first);
    expect(first).toMatchObject({
      zones: "4",
      locations: "8",
      items: "5",
      units: "10",
      barcodes: "8",
      stock_rows: "5",
    });
  });

  it("creates a demo warehouse, locations and items that the modules can read", async () => {
    await seed();
    expect(await locations.getWarehouse(DEMO)).toMatchObject({ code: "DEMO", isActive: true });
    expect(await locations.getLocation(DEMO, "A-01")).toMatchObject({
      type: "BIN",
      isActive: true,
    });
    expect(await locations.getLocation(DEMO, "B-01")).toMatchObject({ type: "PALLET" });
    expect(await locations.getLocation(DEMO, "SHIP-01")).toMatchObject({ isStaging: true });
    expect(await catalog.getItem("SKU-1")).toMatchObject({ baseUom: "EA", isActive: true });
    expect(await catalog.getItem("JAM-200")).toMatchObject({
      isLotTracked: true,
      hasExpiry: true,
      shelfLifeDays: 365,
    });
  });

  it("has barcodes that say how many each one scan stands for", async () => {
    await seed();
    expect(await catalog.resolveBarcode(WIDGET_CASE_BARCODE)).toMatchObject({
      uom: "CS",
      qtyInBase: 24,
      item: { sku: "WIDGET-100" },
    });
  });

  it("lets inventory post stock for the seeded master data and refuses anything else", async () => {
    await seed();
    const adjust = (sku: string, locationId: string) =>
      inventory.adjust.execute({
        warehouseId: DEMO,
        sku,
        locationId,
        delta: 1,
        reason: "seed test",
      });
    expect((await adjust("SKU-1", "A-01")).ok).toBe(true);
    expect((await adjust("NO-SUCH-SKU", "A-01")).ok).toBe(false);
    expect((await adjust("SKU-1", "Z-99")).ok).toBe(false);
  });

  it("starts with stock that matches the ledger", async () => {
    await seed();
    const found = await new PgLedgerAuditor(pool).findDiscrepancies(100_000);
    expect(found.filter((d) => d.warehouseId === DEMO)).toEqual([]);
  });
});
