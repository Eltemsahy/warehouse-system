import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryCatalogRepository } from "../../modules/catalog/infrastructure/in-memory-catalog-repository.js";
import { PgCatalogRepository } from "../../modules/catalog/infrastructure/pg-catalog-repository.js";
import { catalogRepositoryContract } from "./catalog-repository.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set
// (CI does this against a service container).
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

afterAll(async () => {
  await pool?.end();
});

catalogRepositoryContract("InMemoryCatalogRepository", () => new InMemoryCatalogRepository());

catalogRepositoryContract(
  "PgCatalogRepository",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return new PgCatalogRepository(pool);
  },
  { skip: !postgresEnabled },
);
