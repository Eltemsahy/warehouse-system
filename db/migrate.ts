import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const dir = join(import.meta.dirname, "migrations");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://wms:wms@localhost:5432/wms" });  //password should be set in the environment variable DATABASE_URL and match the database name, user, and password accordingly
await client.connect();
for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  console.log("applying", f);
  await client.query(readFileSync(join(dir, f), "utf8"));
}
await client.end();
