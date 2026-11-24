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

  describe("access control tables", () => {
    const newUserId = async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO identity.user_account (id, username, display_name) VALUES ($1, $2, 'T')",
        [id, `user.${uniq()}`],
      );
      return id;
    };
    const roleId = async (code: string) =>
      (await pool.query<{ id: string }>("SELECT id FROM identity.role WHERE code = $1", [code]))
        .rows[0]?.id;

    it("seeds the system roles, flagging only ADMIN as all-warehouses", async () => {
      const { rows } = await pool.query<{
        code: string;
        is_system: boolean;
        all_warehouses: boolean;
      }>("SELECT code, is_system, all_warehouses FROM identity.role");
      const byCode = new Map(rows.map((r) => [r.code, r]));
      for (const code of [
        "ADMIN",
        "WAREHOUSE_MANAGER",
        "INVENTORY_CONTROLLER",
        "RECEIVER",
        "PUTAWAY_OPERATOR",
        "PICKER",
        "PACKER",
      ]) {
        expect(byCode.get(code)?.is_system, code).toBe(true);
      }
      expect(rows.filter((r) => r.all_warehouses).map((r) => r.code)).toEqual(["ADMIN"]);
    });

    it("gives ADMIN every permission", async () => {
      const { rows } = await pool.query<{ missing: string }>(
        `SELECT p.code AS missing FROM identity.permission p
          WHERE NOT EXISTS (SELECT 1 FROM identity.role_permission rp
                              JOIN identity.role r ON r.id = rp.role_id
                             WHERE r.code = 'ADMIN' AND rp.permission_id = p.id)`,
      );
      expect(rows).toEqual([]);
    });

    it("keeps role and permission codes well formed and unique", async () => {
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.role (code, name, description) VALUES ('lower', 'x', 'x')",
          ),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.role (code, name, description) VALUES ('PICKER', 'x', 'x')",
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.permission (code, resource, action) VALUES ('Bad Code', 'x', 'y')",
          ),
        ),
      ).toBe(CHECK_VIOLATION);
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.permission (code, resource, action) VALUES ('inventory.adjust', 'inventory', 'adjust')",
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it("only assigns existing roles to existing users, once", async () => {
      const user = await newUserId();
      const picker = await roleId("PICKER");
      expect(
        await sqlState(
          pool.query("INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)", [
            randomUUID(),
            picker,
          ]),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await sqlState(
          pool.query("INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)", [
            user,
            randomUUID(),
          ]),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await sqlState(
          pool.query("INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)", [
            user,
            picker,
          ]),
        ),
      ).toBeUndefined();
      expect(
        await sqlState(
          pool.query("INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2)", [
            user,
            picker,
          ]),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });

    it("only grants warehouse access to existing users, once per warehouse", async () => {
      const user = await newUserId();
      const warehouse = randomUUID();
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.user_warehouse_access (user_id, warehouse_id) VALUES ($1, $2)",
            [randomUUID(), warehouse],
          ),
        ),
      ).toBe(FOREIGN_KEY_VIOLATION);
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.user_warehouse_access (user_id, warehouse_id) VALUES ($1, $2)",
            [user, warehouse],
          ),
        ),
      ).toBeUndefined();
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.user_warehouse_access (user_id, warehouse_id) VALUES ($1, $2)",
            [user, warehouse],
          ),
        ),
      ).toBe(UNIQUE_VIOLATION);
    });
  });

  describe("sessions and login attempts", () => {
    const newUserId = async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO identity.user_account (id, username, display_name) VALUES ($1, $2, 'T')",
        [id, `user.${uniq()}`],
      );
      return id;
    };
    const hash = () => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");
    const addSession = (userId: string, tokenHash: string, hours = 12) =>
      pool.query(
        `INSERT INTO identity.session (id, user_id, token_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, now(), now() + make_interval(hours => $4))`,
        [randomUUID(), userId, tokenHash, hours],
      );

    it("stores a session only for an existing user", async () => {
      expect(await sqlState(addSession(randomUUID(), hash()))).toBe(FOREIGN_KEY_VIOLATION);
      expect(await sqlState(addSession(await newUserId(), hash()))).toBeUndefined();
    });

    it("keeps token hashes well formed and unique", async () => {
      const user = await newUserId();
      const h = hash();
      expect(await sqlState(addSession(user, "not-a-hash"))).toBe(CHECK_VIOLATION);
      expect(await sqlState(addSession(user, h.toUpperCase()))).toBe(CHECK_VIOLATION);
      expect(await sqlState(addSession(user, h))).toBeUndefined();
      expect(await sqlState(addSession(user, h))).toBe(UNIQUE_VIOLATION);
    });

    it("refuses a session that ends before it starts", async () => {
      expect(await sqlState(addSession(await newUserId(), hash(), -1))).toBe(CHECK_VIOLATION);
    });

    it("records login attempts and never lets one be modified", async () => {
      const name = `attempt.${uniq()}`;
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.login_attempt (username, ip, success, at) VALUES ($1, '10.0.0.1', false, now())",
            [name],
          ),
        ),
      ).toBeUndefined();
      expect(
        await sqlState(
          pool.query(
            "INSERT INTO identity.login_attempt (username, ip, success, at) VALUES ($1, NULL, true, now())",
            [name],
          ),
        ),
      ).toBeUndefined();
      expect(
        await sqlState(
          pool.query("UPDATE identity.login_attempt SET success = true WHERE username = $1", [
            name,
          ]),
        ),
      ).toBe(INTEGRITY_VIOLATION);
    });
  });
});
