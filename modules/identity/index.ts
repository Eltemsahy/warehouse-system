// PUBLIC INTERFACE of the identity module. Other modules import ONLY from here.
// P1-1 is built in small steps. So far: user accounts (create, read, list, update, disable, reset
// password), password hashing, and roles with per-warehouse access (ADR 0005). Login and route
// protection arrive in the next steps.
import { identityRoutes } from "./api/routes.js";
import { AccessService } from "./application/access-service.js";
import type {
  IdentityRepository,
  PasswordHasher,
  WarehouseDirectory,
} from "./application/ports.js";
import { UserService } from "./application/user-service.js";
import { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
import { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";

export const MODULE_NAME = "identity" as const;

export function createIdentityModule(
  deps: {
    repository?: IdentityRepository;
    hasher?: PasswordHasher;
    /** Used to refuse access grants for warehouses that do not exist. */
    warehouses?: WarehouseDirectory;
  } = {},
) {
  const repository = deps.repository ?? new InMemoryIdentityRepository();
  const hasher = deps.hasher ?? new ScryptPasswordHasher();
  const users = new UserService(repository, hasher);
  const access = new AccessService(repository, deps.warehouses);
  return {
    router: identityRoutes({ users, access }),
    users,
    access,
    /** What the user may do and where; used by route protection (a later step). */
    accessFor: (userId: string) => access.accessFor(userId),
  };
}

export type {
  IdentityRepository,
  PasswordHasher,
  WarehouseDirectory,
} from "./application/ports.js";
export { ADMIN_ROLE, can, NO_ACCESS, type UserAccess } from "./domain/model.js";
export type { CreateUserInput, UpdateUserInput } from "./application/user-service.js";
export { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
export { PgIdentityRepository } from "./infrastructure/pg-identity-repository.js";
export { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";
