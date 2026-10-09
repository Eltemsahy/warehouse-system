import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const dir = join(import.meta.dirname, "migrations");
const MIGRATION_LOCK_ID = 727_001; // arbitrary constant; serialises concurrent runners

// Normalise line endings so Windows checkouts (CRLF) and Linux CI (LF) hash identically.
const checksum = (sql: string) => createHash("sha256").update(sql).digest("hex");
const normalise = (sql: string) => sql.replace(/\r\n/g, "\n");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://wms:wms@localhost:5432/wms",
});
await client.connect();

try {
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

  await client.query("CREATE SCHEMA IF NOT EXISTS platform");
  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text        NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const { rows } = await client.query<{ filename: string; checksum: string }>(
    "SELECT filename, checksum FROM platform.schema_migrations",
  );
  const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = normalise(readFileSync(join(dir, file), "utf8"));
    const sum = checksum(sql);
    const previous = applied.get(file);

    if (previous !== undefined) {
      if (previous !== sum) {
        throw new Error(`migration ${file} was modified after it was applied; add a new file`);
      }
      console.log("skipping", file);
      continue;
    }

    console.log("applying", file);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO platform.schema_migrations (filename, checksum) VALUES ($1, $2)",
        [file, sum],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.end(); // also releases the advisory lock
}
