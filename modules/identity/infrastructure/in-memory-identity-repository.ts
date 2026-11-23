import type { IdentityRepository, UserFilter, UserPage } from "../application/ports.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  type Credential,
  type Permission,
  type Role,
  type UserAccess,
  type UserAccount,
} from "../domain/model.js";

const lower = (s: string) => s.toLowerCase();
const copy = <T>(value: T): T => structuredClone(value);

/** For tests and local development. Honours the same contract as PgIdentityRepository. */
export class InMemoryIdentityRepository implements IdentityRepository {
  private users = new Map<string, UserAccount>();
  private credentials = new Map<string, Credential>();
  private roles: Role[] = structuredClone([...SYSTEM_ROLES]);
  private userRoles = new Map<string, Set<string>>();
  private warehouseGrants = new Map<string, Set<string>>();

  async insertUser(user: UserAccount, passwordHash: string, algorithm: string) {
    this.checkUnique(user);
    const now = new Date();
    const stored: UserAccount = { ...copy(user), createdAt: now, updatedAt: now, version: 1 };
    this.users.set(stored.id, stored);
    this.credentials.set(stored.id, { userId: stored.id, passwordHash, algorithm, changedAt: now });
    return copy(stored);
  }

  async getUser(id: string) {
    const u = this.users.get(id);
    return u ? copy(u) : null;
  }

  async getUserByUsername(username: string) {
    for (const u of this.users.values()) if (lower(u.username) === lower(username)) return copy(u);
    return null;
  }

  async listUsers(filter: UserFilter): Promise<UserPage> {
    const rows = [...this.users.values()]
      .filter((u) => filter.status === undefined || u.status === filter.status)
      .filter((u) => filter.after === undefined || u.username > filter.after)
      .sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
    const items = rows.slice(0, filter.limit).map(copy);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.username : null };
  }

  async updateUser(user: UserAccount, expectedVersion: number) {
    const current = this.users.get(user.id);
    if (!current) throw new NotFoundError("user");
    if (current.version !== expectedVersion) {
      throw new ConflictError(
        `the user was changed by someone else (expected version ${expectedVersion}, found ${current.version})`,
      );
    }
    this.checkUnique(user);
    const updated: UserAccount = {
      ...current,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      locale: user.locale,
      updatedAt: new Date(),
      updatedBy: user.updatedBy,
      version: current.version + 1,
    };
    this.users.set(updated.id, updated);
    return copy(updated);
  }

  async getCredential(userId: string) {
    const c = this.credentials.get(userId);
    return c ? copy(c) : null;
  }

  async setPassword(userId: string, passwordHash: string, algorithm: string) {
    if (!this.users.has(userId)) throw new NotFoundError("user");
    this.credentials.set(userId, { userId, passwordHash, algorithm, changedAt: new Date() });
  }

  // ---- roles and warehouse access

  async listRoles(): Promise<Role[]> {
    return copy(this.roles);
  }

  async listPermissions(): Promise<Permission[]> {
    return copy([...PERMISSIONS]).sort((a, b) => (a.code < b.code ? -1 : 1));
  }

  async listUserRoles(userId: string) {
    return [...(this.userRoles.get(userId) ?? [])].sort();
  }

  async assignRole(userId: string, roleCode: string) {
    if (!this.roles.some((r) => r.code === roleCode)) throw new NotFoundError("role");
    if (!this.users.has(userId)) throw new NotFoundError("user");
    this.userRoles.set(userId, (this.userRoles.get(userId) ?? new Set()).add(roleCode));
  }

  async removeRole(userId: string, roleCode: string) {
    return this.userRoles.get(userId)?.delete(roleCode) ?? false;
  }

  async listWarehouseAccess(userId: string) {
    return [...(this.warehouseGrants.get(userId) ?? [])].sort();
  }

  async grantWarehouse(userId: string, warehouseId: string) {
    if (!this.users.has(userId)) throw new NotFoundError("user");
    this.warehouseGrants.set(
      userId,
      (this.warehouseGrants.get(userId) ?? new Set()).add(warehouseId),
    );
  }

  async revokeWarehouse(userId: string, warehouseId: string) {
    return this.warehouseGrants.get(userId)?.delete(warehouseId) ?? false;
  }

  async getAccess(userId: string): Promise<UserAccess> {
    const held = this.roles.filter((r) => this.userRoles.get(userId)?.has(r.code));
    return {
      permissions: [...new Set(held.flatMap((r) => r.permissions))].sort(),
      allWarehouses: held.some((r) => r.allWarehouses),
      warehouseIds: await this.listWarehouseAccess(userId),
    };
  }

  async otherActiveHolders(roleCode: string, excludingUserId: string) {
    let n = 0;
    for (const [userId, codes] of this.userRoles) {
      if (
        userId !== excludingUserId &&
        codes.has(roleCode) &&
        this.users.get(userId)?.status === "ACTIVE"
      )
        n++;
    }
    return n;
  }

  /** Username and email must be unique ignoring case; the user itself does not clash with itself. */
  private checkUnique(user: UserAccount) {
    for (const other of this.users.values()) {
      if (other.id === user.id) continue;
      if (lower(other.username) === lower(user.username)) {
        throw new ConflictError("this username is already taken");
      }
      if (user.email !== null && other.email !== null && lower(other.email) === lower(user.email)) {
        throw new ConflictError("this email is already in use");
      }
    }
  }
}
