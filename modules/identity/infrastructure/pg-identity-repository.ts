import type { Pool } from "pg";
import type { IdentityRepository, UserFilter, UserPage } from "../application/ports.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type {
  Credential,
  Permission,
  Role,
  UserAccess,
  UserAccount,
  UserStatus,
} from "../domain/model.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// Postgres sorts text by locale; the contract and the in-memory adapter sort by code unit.
const sorted = (values: string[]) => [...values].sort();

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

  // ---- roles and warehouse access

  async listRoles(): Promise<Role[]> {
    const { rows } = await this.pool.query<{
      code: string;
      name: string;
      description: string;
      is_system: boolean;
      all_warehouses: boolean;
      permissions: string[];
    }>(
      `SELECT r.code, r.name, r.description, r.is_system, r.all_warehouses,
              COALESCE(array_agg(p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
         FROM identity.role r
         LEFT JOIN identity.role_permission rp ON rp.role_id = r.id
         LEFT JOIN identity.permission p ON p.id = rp.permission_id
        GROUP BY r.id`,
    );
    return rows
      .map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        allWarehouses: r.all_warehouses,
        permissions: sorted(r.permissions),
      }))
      .sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  async listPermissions(): Promise<Permission[]> {
    const { rows } = await this.pool.query<Permission>(
      "SELECT code, resource, action FROM identity.permission",
    );
    return rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  async listUserRoles(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ code: string }>(
      `SELECT r.code FROM identity.user_role ur
         JOIN identity.role r ON r.id = ur.role_id WHERE ur.user_id = $1`,
      [userId],
    );
    return sorted(rows.map((r) => r.code));
  }

  async assignRole(userId: string, roleCode: string): Promise<void> {
    const role = await this.pool.query<{ id: string }>(
      "SELECT id FROM identity.role WHERE code = $1",
      [roleCode],
    );
    if (!role.rows[0]) throw new NotFoundError("role");
    try {
      await this.pool.query(
        "INSERT INTO identity.user_role (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, role.rows[0].id],
      );
    } catch (e) {
      if ((e as { code?: string }).code === FOREIGN_KEY_VIOLATION) throw new NotFoundError("user");
      throw e;
    }
  }

  async removeRole(userId: string, roleCode: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM identity.user_role
        WHERE user_id = $1 AND role_id = (SELECT id FROM identity.role WHERE code = $2)`,
      [userId, roleCode],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async listWarehouseAccess(userId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ warehouse_id: string }>(
      "SELECT warehouse_id::text FROM identity.user_warehouse_access WHERE user_id = $1",
      [userId],
    );
    return sorted(rows.map((r) => r.warehouse_id));
  }

  async grantWarehouse(userId: string, warehouseId: string): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO identity.user_warehouse_access (user_id, warehouse_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, warehouseId],
      );
    } catch (e) {
      if ((e as { code?: string }).code === FOREIGN_KEY_VIOLATION) throw new NotFoundError("user");
      throw e;
    }
  }

  async revokeWarehouse(userId: string, warehouseId: string): Promise<boolean> {
    const res = await this.pool.query(
      "DELETE FROM identity.user_warehouse_access WHERE user_id = $1 AND warehouse_id = $2",
      [userId, warehouseId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async getAccess(userId: string): Promise<UserAccess> {
    const { rows } = await this.pool.query<{
      permissions: string[];
      all_warehouses: boolean;
      warehouse_ids: string[];
    }>(
      `SELECT
         COALESCE((SELECT array_agg(DISTINCT p.code)
                     FROM identity.user_role ur
                     JOIN identity.role_permission rp ON rp.role_id = ur.role_id
                     JOIN identity.permission p ON p.id = rp.permission_id
                    WHERE ur.user_id = $1), '{}') AS permissions,
         EXISTS (SELECT 1 FROM identity.user_role ur
                   JOIN identity.role r ON r.id = ur.role_id
                  WHERE ur.user_id = $1 AND r.all_warehouses) AS all_warehouses,
         COALESCE((SELECT array_agg(warehouse_id::text)
                     FROM identity.user_warehouse_access WHERE user_id = $1), '{}') AS warehouse_ids`,
      [userId],
    );
    const r = first(rows);
    return {
      permissions: sorted(r.permissions),
      allWarehouses: r.all_warehouses,
      warehouseIds: sorted(r.warehouse_ids),
    };
  }

  async otherActiveHolders(roleCode: string, excludingUserId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM identity.user_role ur
         JOIN identity.role r ON r.id = ur.role_id
         JOIN identity.user_account u ON u.id = ur.user_id
        WHERE r.code = $1 AND u.status = 'ACTIVE' AND u.id <> $2`,
      [roleCode, excludingUserId],
    );
    return first(rows).n;
  }
}
