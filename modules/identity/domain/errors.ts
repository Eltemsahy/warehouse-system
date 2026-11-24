/** Base class: anything the API can explain to a caller. */
export class IdentityError extends Error {}

/** The resource a request is about does not exist. Maps to 404. */
export class NotFoundError extends IdentityError {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** A duplicate username or email, or a stale version. Maps to 409. */
export class ConflictError extends IdentityError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** Well-formed input that breaks a rule. Maps to 422. */
export class RuleViolationError extends IdentityError {
  constructor(message: string) {
    super(message);
    this.name = "RuleViolationError";
  }
}

/** Wrong credentials, or no valid session. Maps to 401. Never says which part was wrong. */
export class AuthenticationError extends IdentityError {
  constructor(message = "invalid username or password") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Too many failed attempts for this username or address. Maps to 429. */
export class TooManyAttemptsError extends IdentityError {
  constructor(readonly retryAfterSeconds: number) {
    super("too many failed attempts, try again later");
    this.name = "TooManyAttemptsError";
  }
}
