import type {
  Credential,
  Permission,
  Role,
  Session,
  UserAccess,
  UserAccount,
  UserStatus,
} from "../domain/model.js";

export interface UserFilter {
  status?: UserStatus;
  /** Keyset pagination: only users whose username sorts after this one. */
  after?: string;
  limit: number;
}

export interface UserPage {
  items: UserAccount[];
  /** Pass as `after` to get the next page; null on the last page. */
  nextAfter: string | null;
}

/**
 * Hashes and checks passwords. The hash is self-describing, so the cost can be raised later and
 * old hashes still verify (and report that they should be upgraded).
 */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** False for a wrong password and for a malformed stored hash. Takes constant time per hash. */
  verify(plain: string, stored: string): Promise<boolean>;
  /** True when the stored hash was made with weaker settings than the current ones. */
  needsRehash(stored: string): boolean;
  readonly algorithm: string;
}

/**
 * Persistence for the identity module. Every adapter must pass
 * tests/contract/identity-repository.contract.ts. Errors every adapter throws:
 * - insertUser: ConflictError for a username or email already in use (compared ignoring case).
 * - updateUser: NotFoundError when the user is missing, ConflictError for a stale version or an
 *   email already in use. It never changes the username.
 * - setPassword: NotFoundError when the user is missing.
 */
export interface IdentityRepository {
  /** Creates the account and its credential together. */
  insertUser(user: UserAccount, passwordHash: string, algorithm: string): Promise<UserAccount>;
  getUser(id: string): Promise<UserAccount | null>;
  /** Case-insensitive. */
  getUserByUsername(username: string): Promise<UserAccount | null>;
  listUsers(filter: UserFilter): Promise<UserPage>;
  /** Only displayName, email, status and locale can change. */
  updateUser(user: UserAccount, expectedVersion: number): Promise<UserAccount>;

  getCredential(userId: string): Promise<Credential | null>;
  setPassword(userId: string, passwordHash: string, algorithm: string): Promise<void>;

  // ---- roles and warehouse access (ADR 0005)

  /** Every role with its permission codes, sorted by role code. */
  listRoles(): Promise<Role[]>;
  listPermissions(): Promise<Permission[]>;
  /** Codes of the roles the user holds, sorted. */
  listUserRoles(userId: string): Promise<string[]>;
  /** Idempotent. NotFoundError when the user or the role does not exist. */
  assignRole(userId: string, roleCode: string): Promise<void>;
  /** True when the assignment existed and was removed. */
  removeRole(userId: string, roleCode: string): Promise<boolean>;
  /** Warehouse ids granted to the user one by one, sorted. */
  listWarehouseAccess(userId: string): Promise<string[]>;
  /** Idempotent. NotFoundError when the user does not exist. */
  grantWarehouse(userId: string, warehouseId: string): Promise<void>;
  /** True when the grant existed and was removed. */
  revokeWarehouse(userId: string, warehouseId: string): Promise<boolean>;
  /** Effective access from all the user's roles and grants, whatever the user's status. */
  getAccess(userId: string): Promise<UserAccess>;
  /** How many ACTIVE users other than `excludingUserId` hold the role. */
  otherActiveHolders(roleCode: string, excludingUserId: string): Promise<number>;
}

/** Tells identity whether a warehouse exists. Implemented in the composition root. */
export interface WarehouseDirectory {
  exists(warehouseId: string): Promise<boolean>;
}

export interface NewSession {
  id: string;
  userId: string;
  /** SHA-256 of the token, in hex. The token itself is never stored. */
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
}

export interface LoginAttempt {
  /** Lower-cased and cut to 100 characters; may name a user that does not exist. */
  username: string;
  ip: string | null;
  success: boolean;
  at: Date;
}

/** Sessions and login attempts (ADR 0006). Times come from the caller, never from the database. */
export interface SessionRepository {
  createSession(session: NewSession): Promise<void>;
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  /** True when the session existed and was not yet revoked. */
  revokeSession(id: string, at: Date): Promise<boolean>;
  /** Revokes every session of the user not yet revoked, except one. Returns how many. */
  revokeUserSessions(userId: string, at: Date, exceptSessionId?: string): Promise<number>;
  recordLoginAttempt(attempt: LoginAttempt): Promise<void>;
  /** Failures for this username since `since`, ignoring those before its latest success. */
  countUsernameFailures(username: string, since: Date): Promise<number>;
  /** Failures from this address since `since`. A success does not reset them. */
  countIpFailures(ip: string, since: Date): Promise<number>;
}
