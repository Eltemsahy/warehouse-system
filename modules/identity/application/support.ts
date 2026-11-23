import { err, ok, type Result } from "../../../shared/kernel/index.js";
import { IdentityError, RuleViolationError } from "../domain/errors.js";
import type { IdentityRepository } from "./ports.js";
import {
  ADMIN_ROLE,
  EMAIL_PATTERN,
  LOCALE_PATTERN,
  USERNAME_MESSAGE,
  USERNAME_PATTERN,
  type Audited,
  type UserAccount,
} from "../domain/model.js";

/** Runs a repository call and turns the module's own errors into a Result. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, IdentityError>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof IdentityError) return err(e);
    throw e;
  }
}

export const violation = (message: string) => err(new RuleViolationError(message));

/** Audit fields for a new row. The repository overwrites the timestamps with its own clock. */
export function newAudit(createdBy: string | null = null): Audited {
  const now = new Date();
  return { createdAt: now, updatedAt: now, createdBy, updatedBy: null, version: 1 };
}

export const usernameProblem = (username: string) =>
  USERNAME_PATTERN.test(username) ? undefined : `username ${USERNAME_MESSAGE}`;

export function emailProblem(email: string | null | undefined): string | undefined {
  if (email === null || email === undefined) return undefined;
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? undefined : "email is not valid";
}

export const localeProblem = (locale: string) =>
  LOCALE_PATTERN.test(locale) ? undefined : "locale must look like en or ar-EG";

export function textProblem(what: string, value: string, max: number): string | undefined {
  const length = value.trim().length;
  return length >= 1 && length <= max ? undefined : `${what} must be 1 to ${max} characters`;
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when this user is an active administrator and no other active user holds ADMIN: taking
 * the role away, or disabling the account, would leave nobody able to manage access.
 */
export async function isLastActiveAdmin(
  repo: IdentityRepository,
  user: UserAccount,
): Promise<boolean> {
  if (user.status !== "ACTIVE") return false;
  if (!(await repo.listUserRoles(user.id)).includes(ADMIN_ROLE)) return false;
  return (await repo.otherActiveHolders(ADMIN_ROLE, user.id)) === 0;
}
