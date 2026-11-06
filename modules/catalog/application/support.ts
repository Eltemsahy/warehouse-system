import { err, ok, type Result } from "../../../shared/kernel/index.js";
import { CatalogError, RuleViolationError } from "../domain/errors.js";
import { CODE_MESSAGE, isValidCode, type Audited } from "../domain/model.js";

/** Runs a repository call and turns the module's own errors into a Result. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, CatalogError>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof CatalogError) return err(e);
    throw e;
  }
}

export const violation = (message: string) => err(new RuleViolationError(message));

/** Audit fields for a new row. The repository overwrites the timestamps with its own clock. */
export function newAudit(): Audited {
  const now = new Date();
  return { createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, version: 1 };
}

export const codeProblem = (what: string, code: string) =>
  isValidCode(code) ? undefined : `${what} ${CODE_MESSAGE}`;

export function textProblem(what: string, value: string, max: number): string | undefined {
  const length = value.trim().length;
  return length >= 1 && length <= max ? undefined : `${what} must be 1 to ${max} characters`;
}

/** Dimensions and weight: a number of 0 or more, or null/undefined for "not set". */
export function measureProblem(what: string, value: number | null | undefined) {
  if (value === null || value === undefined) return undefined;
  return Number.isFinite(value) && value >= 0 ? undefined : `${what} must be a number of 0 or more`;
}

export function quantityProblem(value: number): string | undefined {
  return Number.isInteger(value) && value >= 1
    ? undefined
    : "quantity in base units must be a whole number of 1 or more";
}
