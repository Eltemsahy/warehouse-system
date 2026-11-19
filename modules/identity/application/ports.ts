import type { Credential, UserAccount, UserStatus } from "../domain/model.js";

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
}
