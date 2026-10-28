/** Base class: anything the API can explain to a caller. */
export class LocationsError extends Error {}

/** The resource a request is about does not exist. Maps to 404. */
export class NotFoundError extends LocationsError {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The request clashes with current state: a duplicate code or a stale version. Maps to 409. */
export class ConflictError extends LocationsError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** The request is well formed but breaks a rule or points at something invalid. Maps to 422. */
export class RuleViolationError extends LocationsError {
  constructor(message: string) {
    super(message);
    this.name = "RuleViolationError";
  }
}
