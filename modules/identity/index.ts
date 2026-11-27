// PUBLIC INTERFACE of the identity module. Other modules import ONLY from here.
// P1-1 is built in small steps. So far: user accounts (create, read, list, update, disable, reset
// password), password hashing, roles with per-warehouse access (ADR 0005), and login with opaque
// session tokens (ADR 0006). Route protection arrives in the next step.
import { identityRoutes } from "./api/routes.js";
import { AccessService } from "./application/access-service.js";
import { AuthService, type AuthOptions } from "./application/auth-service.js";
import type {
  IdentityRepository,
  PasswordHasher,
  SessionRepository,
  WarehouseDirectory,
} from "./application/ports.js";
import { UserService } from "./application/user-service.js";
import { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
import { InMemorySessionRepository } from "./infrastructure/in-memory-session-repository.js";
import { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";

export const MODULE_NAME = "identity" as const;

export function createIdentityModule(
  deps: {
    repository?: IdentityRepository;
    sessions?: SessionRepository;
    hasher?: PasswordHasher;
    /** Used to refuse access grants for warehouses that do not exist. */
    warehouses?: WarehouseDirectory;
    auth?: AuthOptions;
    /** Tests move time with it. */
    clock?: () => Date;
  } = {},
) {
  const repository = deps.repository ?? new InMemoryIdentityRepository();
  const hasher = deps.hasher ?? new ScryptPasswordHasher();
  const sessions = deps.sessions ?? new InMemorySessionRepository();
  const users = new UserService(repository, hasher, sessions);
  const access = new AccessService(repository, deps.warehouses);
  const auth = new AuthService(repository, sessions, hasher, deps.auth, deps.clock);
  return {
    router: identityRoutes({ users, access, auth }),
    users,
    access,
    auth,
    /** Who is calling, from a session token; used by route protection (a later step). */
    authenticate: (token: string) => auth.authenticate(token),
    /** What the user may do and where. */
    accessFor: (userId: string) => access.accessFor(userId),
  };
}

export type {
  IdentityRepository,
  PasswordHasher,
  WarehouseDirectory,
} from "./application/ports.js";
export {
  ADMIN_ROLE,
  can,
  NO_ACCESS,
  PERMISSIONS,
  type Principal,
  type UserAccess,
} from "./domain/model.js";
export type { CreateUserInput, UpdateUserInput } from "./application/user-service.js";
export type { AuthOptions } from "./application/auth-service.js";
export { InMemoryIdentityRepository } from "./infrastructure/in-memory-identity-repository.js";
export { InMemorySessionRepository } from "./infrastructure/in-memory-session-repository.js";
export { PgSessionRepository } from "./infrastructure/pg-session-repository.js";
export { PgIdentityRepository } from "./infrastructure/pg-identity-repository.js";
export { ScryptPasswordHasher } from "./infrastructure/scrypt-password-hasher.js";
