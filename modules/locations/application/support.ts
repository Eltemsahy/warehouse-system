import { err, ok, type Result } from "../../../shared/kernel/index.js";
import { CODE_MESSAGE, isValidCode, type Audited, type LocationCapacity } from "../domain/model.js";
import { LocationsError, RuleViolationError } from "../domain/errors.js";

/** Runs a repository call and turns the module's own errors into a Result. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, LocationsError>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof LocationsError) return err(e);
    throw e;
  }
}

export const violation = (message: string) => err(new RuleViolationError(message));

/** Audit fields for a new row. The repository overwrites the timestamps with its own clock. */
export function newAudit(): Audited {
  const now = new Date();
  return { createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, version: 1 };
}

export function codeProblem(what: string, code: string): string | undefined {
  return isValidCode(code) ? undefined : `${what} ${CODE_MESSAGE}`;
}

export function nameProblem(what: string, name: string): string | undefined {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 120
    ? undefined
    : `${what} must be 1 to 120 characters`;
}

export function shortTextProblem(what: string, value: string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  return value.length >= 1 && value.length <= 32 ? undefined : `${what} must be 1 to 32 characters`;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Fills the gaps with null and checks the numbers. Returns a message when something is wrong. */
export function normalizeCapacity(
  input: Partial<LocationCapacity>,
): { capacity: LocationCapacity } | { problem: string } {
  const capacity: LocationCapacity = {
    maxUnits: input.maxUnits ?? null,
    maxWeight: input.maxWeight ?? null,
    maxVolume: input.maxVolume ?? null,
    maxLpns: input.maxLpns ?? null,
  };
  for (const key of ["maxUnits", "maxLpns"] as const) {
    const v = capacity[key];
    if (v !== null && (!Number.isInteger(v) || v < 0)) {
      return { problem: `${key} must be a whole number of 0 or more` };
    }
  }
  for (const key of ["maxWeight", "maxVolume"] as const) {
    const v = capacity[key];
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      return { problem: `${key} must be a number of 0 or more` };
    }
  }
  return { capacity };
}
