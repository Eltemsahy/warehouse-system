import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryIdempotencyStore, PgIdempotencyStore } from "../../shared/http/index.js";
import { idempotencyStoreContract } from "./idempotency-store.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

afterAll(async () => {
  await pool?.end();
});

idempotencyStoreContract("InMemoryIdempotencyStore", () => new InMemoryIdempotencyStore());

idempotencyStoreContract(
  "PgIdempotencyStore",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return new PgIdempotencyStore(pool);
  },
  { skip: !postgresEnabled },
);
