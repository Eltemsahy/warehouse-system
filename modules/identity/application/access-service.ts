import { err, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type IdentityError } from "../domain/errors.js";
import {
  ADMIN_ROLE,
  NO_ACCESS,
  type Permission,
  type Role,
  type UserAccess,
} from "../domain/model.js";
import type { IdentityRepository, WarehouseDirectory } from "./ports.js";
import { attempt, isLastActiveAdmin, UUID_PATTERN, violation } from "./support.js";

/**
 * Roles and warehouse access for users (ADR 0005). Roles and permissions are fixed by the
 * migrations; this service only assigns them. Nothing here knows who is calling yet.
 */
export class AccessService {
  constructor(
    private repo: IdentityRepository,
    /** Without it, any well-formed warehouse id is accepted (tests). The app always passes one. */
    private warehouses?: WarehouseDirectory,
  ) {}

  listRoles(): Promise<Role[]> {
    return this.repo.listRoles();
  }

  listPermissions(): Promise<Permission[]> {
    return this.repo.listPermissions();
  }

  async rolesOf(userId: string): Promise<Result<Role[], IdentityError>> {
    if (!(await this.repo.getUser(userId))) return err(new NotFoundError("user"));
    const held = new Set(await this.repo.listUserRoles(userId));
    return ok((await this.repo.listRoles()).filter((r) => held.has(r.code)));
  }

  /** Idempotent: assigning a role the user already holds succeeds. */
  async assignRole(userId: string, roleCode: string): Promise<Result<null, IdentityError>> {
    const missing = await this.missing(userId, roleCode);
    if (missing) return err(missing);
    return attempt(async () => {
      await this.repo.assignRole(userId, roleCode);
      return null;
    });
  }

  async removeRole(userId: string, roleCode: string): Promise<Result<null, IdentityError>> {
    const missing = await this.missing(userId, roleCode);
    if (missing) return err(missing);
    const user = await this.repo.getUser(userId);
    if (roleCode === ADMIN_ROLE && user && (await isLastActiveAdmin(this.repo, user))) {
      return violation("the last active administrator cannot lose the administrator role");
    }
    if (!(await this.repo.removeRole(userId, roleCode))) {
      return err(new NotFoundError("role assignment"));
    }
    return ok(null);
  }

  async warehousesOf(userId: string): Promise<Result<string[], IdentityError>> {
    if (!(await this.repo.getUser(userId))) return err(new NotFoundError("user"));
    return ok(await this.repo.listWarehouseAccess(userId));
  }

  /** Idempotent. The warehouse must exist (checked through the directory). */
  async grantWarehouse(userId: string, warehouseId: string): Promise<Result<null, IdentityError>> {
    if (!UUID_PATTERN.test(warehouseId)) return violation("warehouse id must be a uuid");
    const id = warehouseId.toLowerCase();
    if (!(await this.repo.getUser(userId))) return err(new NotFoundError("user"));
    if (this.warehouses && !(await this.warehouses.exists(id))) {
      return violation("the warehouse does not exist");
    }
    return attempt(async () => {
      await this.repo.grantWarehouse(userId, id);
      return null;
    });
  }

  /** Works for a warehouse that no longer resolves: stale grants must be removable. */
  async revokeWarehouse(userId: string, warehouseId: string): Promise<Result<null, IdentityError>> {
    if (!(await this.repo.getUser(userId))) return err(new NotFoundError("user"));
    if (!(await this.repo.revokeWarehouse(userId, warehouseId.toLowerCase()))) {
      return err(new NotFoundError("warehouse access"));
    }
    return ok(null);
  }

  /** What the user may do and where. A missing or disabled user may do nothing. */
  async accessFor(userId: string): Promise<UserAccess> {
    const user = await this.repo.getUser(userId);
    if (!user || user.status !== "ACTIVE") return NO_ACCESS;
    return this.repo.getAccess(userId);
  }

  private async missing(userId: string, roleCode: string): Promise<NotFoundError | undefined> {
    if (!(await this.repo.getUser(userId))) return new NotFoundError("user");
    if (!(await this.repo.listRoles()).some((r) => r.code === roleCode))
      return new NotFoundError("role");
    return undefined;
  }
}
