export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
export const USERNAME_MESSAGE = "must be 3 to 64 letters, digits, dot, underscore or hyphen";
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Audit columns shared by every mutable table (Schema doc, global conventions). */
export interface Audited {
  createdAt: Date;
  updatedAt: Date;
  /** User ids. Null for the first administrator and for rows created before login exists. */
  createdBy: string | null;
  updatedBy: string | null;
  /** Optimistic lock: starts at 1, +1 on every update. */
  version: number;
}

/** A person (or a scanner login) who can sign in. Never carries the password hash. */
export interface UserAccount extends Audited {
  id: string;
  /** Unique ignoring case; never changes. */
  username: string;
  email: string | null;
  displayName: string;
  /** DISABLED users cannot sign in. */
  status: UserStatus;
  locale: string;
}

export interface Credential {
  userId: string;
  /** Self-describing: includes the algorithm, its cost and the salt. */
  passwordHash: string;
  algorithm: string;
  changedAt: Date;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * NIST-style policy: a minimum length, a maximum that only guards against abuse, and no
 * composition rules. Returns a message when the password is not acceptable.
 */
export function passwordProblem(password: string, username?: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return "password must not be the same as the username";
  }
  return undefined;
}
