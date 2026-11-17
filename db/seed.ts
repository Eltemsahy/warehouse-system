// Loads the demo data in db/seeds/dev.sql: a demo warehouse with zones, locations, items,
// barcodes and some starting stock. Run `npm run migrate` first. Safe to run again (it skips what
// already exists and never overwrites). Refuses to run when NODE_ENV=production.
//   npm run seed
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

if (process.env.NODE_ENV === "production") {
  console.error("refusing to load demo data into a production environment");
  process.exit(1);
}

const sql = readFileSync(join(import.meta.dirname, "seeds", "dev.sql"), "utf8");
const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://wms:wms@localhost:5432/wms",
});
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");

  const { rows } = await client.query<{ warehouses: string; locations: string; items: string }>(
    `SELECT (SELECT count(*) FROM locations.warehouse) AS warehouses,
            (SELECT count(*) FROM locations.location)  AS locations,
            (SELECT count(*) FROM catalog.item)        AS items`,
  );
  console.log("demo data is in place:", rows[0]);
} catch (e) {
  await client.query("ROLLBACK");
  console.error("could not load the demo data (has `npm run migrate` been run?):", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
