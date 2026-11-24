import { afterAll } from "vitest";
import pg from "pg";
import { InMemoryIdentityRepository } from "../../modules/identity/infrastructure/in-memory-identity-repository.js";
import { InMemorySessionRepository } from "../../modules/identity/infrastructure/in-memory-session-repository.js";
import { PgIdentityRepository } from "../../modules/identity/infrastructure/pg-identity-repository.js";
import { PgSessionRepository } from "../../modules/identity/infrastructure/pg-session-repository.js";
import { sessionRepositoryContract } from "./session-repository.contract.js";

// In-memory always runs. Postgres runs only with LEDGER_DRIVER=postgres and DATABASE_URL set.
const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

afterAll(async () => {
  await pool?.end();
});

sessionRepositoryContract("InMemorySessionRepository", () => ({
  sessions: new InMemorySessionRepository(),
  users: new InMemoryIdentityRepository(),
}));

sessionRepositoryContract(
  "PgSessionRepository",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return { sessions: new PgSessionRepository(pool), users: new PgIdentityRepository(pool) };
  },
  { skip: !postgresEnabled },
);
