import type { IdentityRepository, UserFilter, UserPage } from "../application/ports.js";
import { ConflictError, NotFoundError } from "../domain/errors.js";
import type { Credential, UserAccount } from "../domain/model.js";

const lower = (s: string) => s.toLowerCase();
const copy = <T>(value: T): T => structuredClone(value);

/** For tests and local development. Honours the same contract as PgIdentityRepository. */
export class InMemoryIdentityRepository implements IdentityRepository {
  private users = new Map<string, UserAccount>();
  private credentials = new Map<string, Credential>();

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
