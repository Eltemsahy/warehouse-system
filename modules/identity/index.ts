// PUBLIC INTERFACE of the identity module. Other modules import ONLY from here.
// P1-1 is built in small steps. So far: user accounts (create, read, list, update, disable, reset
// password) and password hashing. Roles, login and route protection arrive in the next steps.
import { identityRoutes } from "./api/routes.js";
import type { IdentityRepository, PasswordHasher } from "./application/ports.js";
import { UserService } from "./application/user-service.js";
import { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
import { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";

export const MODULE_NAME = "identity" as const;

export function createIdentityModule(
  deps: { repository?: IdentityRepository; hasher?: PasswordHasher } = {},
) {
  const repository = deps.repository ?? new InMemoryIdentityRepository();
  const hasher = deps.hasher ?? new ScryptPasswordHasher();
  const users = new UserService(repository, hasher);
  return {
    router: identityRoutes({ users }),
    users,
  };
}

export type { IdentityRepository, PasswordHasher } from "./application/ports.js";
export type { CreateUserInput, UpdateUserInput } from "./application/user-service.js";
export { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
export { PgIdentityRepository } from "./infrastructure/pg-identity-repository.js";
export { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";
