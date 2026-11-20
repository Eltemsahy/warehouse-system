// PUBLIC INTERFACE of the identity module. Other modules import ONLY from here.
// P1-1 is built in small steps. This one provides the user store and password hashing; user
// management, roles, login and route protection arrive in the next steps.
export const MODULE_NAME = "identity" as const;

export type { IdentityRepository, PasswordHasher } from "./application/ports.js";
export { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
export { PgIdentityRepository } from "./infrastructure/pg-identity-repository.js";
export { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";
