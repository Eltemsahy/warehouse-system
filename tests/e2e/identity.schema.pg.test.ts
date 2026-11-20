import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = process.env.LEDGER_DRIVER === "postgres";

/** The SQLSTATE of the error a statement raises, or undefined when it succeeds. */
async function sqlState(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INTEGRITY_VIOLATION = "23000"; // raised by the immutability trigger

describe.skipIf(!enabled)("identity schema (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  const uniq = () => randomUUID().slice(0, 8);

  const addUser = (username = `user.${uniq()}`, extra = "", value = "") =>
    pool.query(
      `INSERT INTO identity.user_account (id, username, display_name${extra}) VALUES ($1, $2, 'Test'${value})`,
      [randomUUID(), username],
    );

  it("rejects usernames with the wrong format", async () => {
    for (const bad of ["ab", "has space", "x".repeat(65), "semi;colon", ""]) {
      expect(await sqlState(addUser(bad)), JSON.stringify(bad)).toBe(CHECK_VIOLATION);
    }
  });

  it("keeps usernames unique, ignoring case", async () => {
    const name = `Mixed.${uniq()}`;
    await addUser(name);
    expect(await sqlState(addUser(name.toUpperCase()))).toBe(UNIQUE_VIOLATION);
  });

  it("keeps emails well formed and unique ignoring case, but optional", async () => {
    const email = `Some.One.${uniq()}@Example.test`;
    expect(await sqlState(addUser(`user.${uniq()}`, ", email", `, '${email}'`))).toBeUndefined();
    expect(await sqlState(addUser(`user.${uniq()}`, ", email", `, '${email.toUpperCase()}'`))).toBe(
      UNIQUE_VIOLATION,
    );
    expect(await sqlState(addUser(`user.${uniq()}`, ", email", ", 'not-an-email'"))).toBe(
      CHECK_VIOLATION,
    );
    expect(await sqlState(addUser(`user.${uniq()}`))).toBeUndefined(); // no email
    expect(await sqlState(addUser(`user.${uniq()}`))).toBeUndefined(); // and another with none
  });

  it("refuses an unknown status and a malformed locale", async () => {
    expect(await sqlState(addUser(`user.${uniq()}`, ", status", ", 'LOCKED'"))).toBe(
      CHECK_VIOLATION,
    );
    expect(await sqlState(addUser(`user.${uniq()}`, ", locale", ", 'English'"))).toBe(
      CHECK_VIOLATION,
    );
    expect(await sqlState(addUser(`user.${uniq()}`, ", locale", ", 'ar-EG'"))).toBeUndefined();
  });

  it("refuses to change a username", async () => {
    const name = `fixed.${uniq()}`;
    await addUser(name);
    expect(
      await sqlState(
        pool.query("UPDATE identity.user_account SET username = $2 WHERE username = $1", [
          name,
          `other.${uniq()}`,
        ]),
      ),
    ).toBe(INTEGRITY_VIOLATION);
  });

  it("only allows a credential for an existing user, one per user", async () => {
    expect(
      await sqlState(
        pool.query(
          "INSERT INTO identity.credential (user_id, password_hash, algorithm) VALUES ($1, 'h', 'scrypt')",
          [randomUUID()],
        ),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);

    const id = randomUUID();
    await pool.query(
      "INSERT INTO identity.user_account (id, username, display_name) VALUES ($1, $2, 'T')",
      [id, `user.${uniq()}`],
    );
    await pool.query(
      "INSERT INTO identity.credential (user_id, password_hash, algorithm) VALUES ($1, 'h', 'scrypt')",
      [id],
    );
    expect(
      await sqlState(
        pool.query(
          "INSERT INTO identity.credential (user_id, password_hash, algorithm) VALUES ($1, 'h2', 'scrypt')",
          [id],
        ),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });
});
