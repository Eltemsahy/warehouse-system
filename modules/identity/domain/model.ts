export const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
export const USERNAME_MESSAGE = "must be 3 to 64 letters, digits, dot, underscore or hyphen";
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Audit columns shared by every mutable table (Schema doc, global conventions). */
export interface Audited {
  createdAt: Date;
  updatedAt: Date;
  /** User ids. Null for the first administrator and for rows created before login exists. */
  createdBy: string | null;
  updatedBy: string | null;
  /** Optimistic lock: starts at 1, +1 on every update. */
  version: number;
}

/** A person (or a scanner login) who can sign in. Never carries the password hash. */
export interface UserAccount extends Audited {
  id: string;
  /** Unique ignoring case; never changes. */
  username: string;
  email: string | null;
  displayName: string;
  /** DISABLED users cannot sign in. */
  status: UserStatus;
  locale: string;
}

export interface Credential {
  userId: string;
  /** Self-describing: includes the algorithm, its cost and the salt. */
  passwordHash: string;
  algorithm: string;
  changedAt: Date;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * NIST-style policy: a minimum length, a maximum that only guards against abuse, and no
 * composition rules. Returns a message when the password is not acceptable.
 */
export function passwordProblem(password: string, username?: string): string | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (username && password.toLowerCase() === username.toLowerCase()) {
    return "password must not be the same as the username";
  }
  return undefined;
}

// ---- access control (ADR 0005)

export const ADMIN_ROLE = "ADMIN";

export interface Permission {
  /** Dotted code such as "inventory.adjust". */
  code: string;
  resource: string;
  action: string;
}

export interface Role {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Holders can act in every warehouse, including ones created later. */
  allWarehouses: boolean;
  /** Permission codes, sorted. */
  permissions: string[];
}

/** What a user may do, and where. The one record every authorisation check works from. */
export interface UserAccess {
  /** Permission codes from all the user's roles, sorted and without duplicates. */
  permissions: string[];
  allWarehouses: boolean;
  /** Warehouses granted one by one, sorted. Not needed when `allWarehouses` is true. */
  warehouseIds: string[];
}

export const NO_ACCESS: UserAccess = { permissions: [], allWarehouses: false, warehouseIds: [] };

/**
 * May this user do `permission`, and, when the action belongs to a warehouse, in that warehouse?
 * An action that belongs to no warehouse (the catalog, user administration) needs only the
 * permission.
 */
export function can(access: UserAccess, permission: string, warehouseId?: string): boolean {
  if (!access.permissions.includes(permission)) return false;
  if (warehouseId === undefined || access.allWarehouses) return true;
  return access.warehouseIds.includes(warehouseId.toLowerCase());
}

export const ROLE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

const permission = (code: string): Permission => {
  const cut = code.lastIndexOf(".");
  return { code, resource: code.slice(0, cut), action: code.slice(cut + 1) };
};

/** The permissions that exist. Must match what db/migrations/010_identity_access.sql seeds. */
export const PERMISSIONS: readonly Permission[] = [
  "identity.users.read",
  "identity.users.manage",
  "identity.access.manage",
  "locations.read",
  "locations.manage",
  "catalog.read",
  "catalog.manage",
  "inventory.read",
  "inventory.adjust",
  "inventory.transfer",
].map(permission);

const role = (
  code: string,
  name: string,
  description: string,
  permissions: string[],
  allWarehouses = false,
): Role => ({
  code,
  name,
  description,
  isSystem: true,
  allWarehouses,
  permissions: [...permissions].sort(),
});

/** The seeded roles. The shared repository contract checks every adapter against this list. */
export const SYSTEM_ROLES: readonly Role[] = [
  role(
    "ADMIN",
    "System administrator",
    "Manages users, access, master data and everything else, in every warehouse.",
    PERMISSIONS.map((p) => p.code),
    true,
  ),
  role(
    "WAREHOUSE_MANAGER",
    "Warehouse manager",
    "Runs a warehouse: master data, stock changes and monitoring.",
    [
      "identity.users.read",
      "locations.read",
      "locations.manage",
      "catalog.read",
      "inventory.read",
      "inventory.adjust",
      "inventory.transfer",
    ],
  ),
  role("INVENTORY_CONTROLLER", "Inventory controller", "Adjusts and transfers stock.", [
    "locations.read",
    "catalog.read",
    "inventory.read",
    "inventory.adjust",
    "inventory.transfer",
  ]),
  role("RECEIVER", "Receiver", "Checks in received goods.", [
    "locations.read",
    "catalog.read",
    "inventory.read",
  ]),
  role("PUTAWAY_OPERATOR", "Putaway operator", "Moves received goods to storage locations.", [
    "locations.read",
    "catalog.read",
    "inventory.read",
    "inventory.transfer",
  ]),
  role("PICKER", "Picker", "Picks orders from storage locations.", [
    "locations.read",
    "catalog.read",
    "inventory.read",
  ]),
  role("PACKER", "Packer / shipping clerk", "Verifies, packs and ships orders.", [
    "catalog.read",
    "inventory.read",
  ]),
].sort((a, b) => (a.code < b.code ? -1 : 1));

// ---- sessions (ADR 0006)

export interface Session {
  id: string;
  userId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Who is calling, resolved from a valid session. */
export interface Principal {
  userId: string;
  username: string;
  sessionId: string;
  expiresAt: Date;
  access: UserAccess;
}
