import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryLedger } from "../../modules/inventory/infrastructure/in-memory-ledger.js";
import { PgStockLedger } from "../../modules/inventory/infrastructure/pg-stock-ledger.js";
import { stockLedgerContract } from "./stock-ledger.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : undefined;

afterAll(async () => {
  await pool?.end();
});

stockLedgerContract("InMemoryLedger", () => new InMemoryLedger());

stockLedgerContract(
  "PgStockLedger",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return new PgStockLedger(pool);
  },
  { skip: !postgresEnabled },
);