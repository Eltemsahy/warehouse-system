import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryIdentityRepository } from "../../modules/identity/infrastructure/in-memory-identity-repository.js";
import { PgIdentityRepository } from "../../modules/identity/infrastructure/pg-identity-repository.js";
import { identityRepositoryContract } from "./identity-repository.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

afterAll(async () => {
  await pool?.end();
});

identityRepositoryContract("InMemoryIdentityRepository", () => new InMemoryIdentityRepository());

identityRepositoryContract(
  "PgIdentityRepository",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return new PgIdentityRepository(pool);
  },
  { skip: !postgresEnabled },
);
