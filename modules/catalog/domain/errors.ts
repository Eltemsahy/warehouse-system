/** Base class: anything the API can explain to a caller. */
export class CatalogError extends Error {}

/** The resource a request is about does not exist. Maps to 404. */
export class NotFoundError extends CatalogError {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** A duplicate code or SKU, or a stale version. Maps to 409. */
export class ConflictError extends CatalogError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Well-formed input that breaks a rule or points at something invalid. Maps to 422. */
export class RuleViolationError extends CatalogError {
  constructor(message: string) {
    super(message);
    this.name = "RuleViolationError";
  }
}
