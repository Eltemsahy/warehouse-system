import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryLocationsRepository } from "../../modules/locations/infrastructure/in-memory-locations-repository.js";
import { PgLocationsRepository } from "../../modules/locations/infrastructure/pg-locations-repository.js";
import { locationsRepositoryContract } from "./locations-repository.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

afterAll(async () => {
  await pool?.end();
});

locationsRepositoryContract("InMemoryLocationsRepository", () => new InMemoryLocationsRepository());

locationsRepositoryContract(
  "PgLocationsRepository",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return new PgLocationsRepository(pool);
  },
  { skip: !postgresEnabled },
);
