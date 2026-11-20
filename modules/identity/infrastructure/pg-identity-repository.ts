import type { Pool } from "pg";
import type { IdentityRepository, UserFilter, UserPage } from "../application/ports.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type { Credential, UserAccount, UserStatus } from "../domain/model.js";

const UNIQUE_VIOLATION = "23505";

/** Turns a unique violation into a message that says which field clashed. Always throws. */
function translate(e: unknown): never {
  const err = e as { code?: string; constraint?: string };
  if (err.code === UNIQUE_VIOLATION) {
    throw new ConflictError(
      err.constraint === "user_email_key"
        ? "this email is already in use"
        : "this username is already taken",
    );
  }
  throw e;
}

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  status: UserStatus;
  locale: string;
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  version: number;
}

const toUser = (r: UserRow): UserAccount => ({
  id: r.id,
  username: r.username,
  email: r.email,
  displayName: r.display_name,
  status: r.status,
  locale: r.locale,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  version: r.version,
});

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected the statement to return a row");
  return row;
}

export class PgIdentityRepository implements IdentityRepository {
  constructor(private pool: Pool) {}

  async insertUser(
    user: UserAccount,
    passwordHash: string,
    algorithm: string,
  ): Promise<UserAccount> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<UserRow>(
        `INSERT INTO identity.user_account
           (id, username, email, display_name, status, locale, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          user.id,
          user.username,
          user.email,
          user.displayName,
          user.status,
          user.locale,
          user.createdBy,
        ],
      );
      await client.query(
        "INSERT INTO identity.credential (user_id, password_hash, algorithm) VALUES ($1, $2, $3)",
        [user.id, passwordHash, algorithm],
      );
      await client.query("COMMIT");
      return toUser(first(rows));
    } catch (e) {
      await client.query("ROLLBACK");
      return translate(e);
    } finally {
      client.release();
    }
  }

  async getUser(id: string): Promise<UserAccount | null> {
    const { rows } = await this.pool.query<UserRow>(
      "SELECT * FROM identity.user_account WHERE id = $1",
      [id],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserByUsername(username: string): Promise<UserAccount | null> {
    const { rows } = await this.pool.query<UserRow>(
      "SELECT * FROM identity.user_account WHERE lower(username) = lower($1)",
      [username],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(filter: UserFilter): Promise<UserPage> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT * FROM identity.user_account
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR username COLLATE "C" > $2)
        ORDER BY username COLLATE "C"
        LIMIT $3`,
      [filter.status ?? null, filter.after ?? null, filter.limit + 1],
    );
    const items = rows.slice(0, filter.limit).map(toUser);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.username : null };
  }

  async updateUser(user: UserAccount, expectedVersion: number): Promise<UserAccount> {
    try {
      const { rows } = await this.pool.query<UserRow>(
        `UPDATE identity.user_account
            SET email = $2, display_name = $3, status = $4, locale = $5,
                updated_by = $6, updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $7
          RETURNING *`,
        [
          user.id,
          user.email,
          user.displayName,
          user.status,
          user.locale,
          user.updatedBy,
          expectedVersion,
        ],
      );
      if (rows[0]) return toUser(rows[0]);
    } catch (e) {
      translate(e);
    }
    // No row matched: it does not exist, or someone else changed it first.
    const { rows } = await this.pool.query<{ version: number }>(
      "SELECT version FROM identity.user_account WHERE id = $1",
      [user.id],
    );
    if (!rows[0]) throw new NotFoundError("user");
    throw new ConflictError(
      `the user was changed by someone else (expected version ${expectedVersion}, found ${rows[0].version})`,
    );
  }

  async getCredential(userId: string): Promise<Credential | null> {
    const { rows } = await this.pool.query<{
      user_id: string;
      password_hash: string;
      algorithm: string;
      changed_at: Date;
    }>("SELECT * FROM identity.credential WHERE user_id = $1", [userId]);
    const r = rows[0];
    return r
      ? {
          userId: r.user_id,
          passwordHash: r.password_hash,
          algorithm: r.algorithm,
          changedAt: r.changed_at,
        }
      : null;
  }

  async setPassword(userId: string, passwordHash: string, algorithm: string): Promise<void> {
    const res = await this.pool.query(
      `UPDATE identity.credential
          SET password_hash = $2, algorithm = $3, changed_at = now()
        WHERE user_id = $1`,
      [userId, passwordHash, algorithm],
    );
    if (res.rowCount === 0) throw new NotFoundError("user");
  }
}
