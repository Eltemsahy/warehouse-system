import type { Rule } from "./security.js";

// Who may call what (ADR 0007). One line per route. Permissions come from the identity module
// (docs/adr/0005-access-control.md); a test checks that every permission named here exists and
// that every route a module registers has a rule here, and the other way round.
//
// Reading master data and stock needs the `.read` permission, changing it the `.manage`, `.adjust`
// or `.transfer` one. Routes that name a warehouse also need access to that warehouse.

const get = (path: string, permission: string, warehouse?: string): Rule => ({
  method: "GET",
  path,
  access: { permission, ...(warehouse ? { warehouse } : {}) },
});
const write = (
  method: Rule["method"],
  path: string,
  permission: string,
  warehouse?: string,
): Rule => ({ method, path, access: { permission, ...(warehouse ? { warehouse } : {}) } });

const W = "warehouseId";

export const inventoryRules: Rule[] = [
  write("POST", "/inventory/warehouses/:warehouseId/adjustments", "inventory.adjust", W),
  write("POST", "/inventory/warehouses/:warehouseId/transfers", "inventory.transfer", W),
  get(
    "/inventory/warehouses/:warehouseId/skus/:sku/locations/:locationId/balance",
    "inventory.read",
    W,
  ),
];

export const locationsRules: Rule[] = [
  // Warehouses themselves. Creating one cannot be scoped to a warehouse that does not exist yet.
  // The list shows every warehouse to anyone who can read locations.
  write("POST", "/locations/warehouses", "locations.manage"),
  get("/locations/warehouses", "locations.read"),
  get("/locations/warehouses/:warehouseId", "locations.read", W),
  write("PATCH", "/locations/warehouses/:warehouseId", "locations.manage", W),
  write("POST", "/locations/warehouses/:warehouseId/zones", "locations.manage", W),
  get("/locations/warehouses/:warehouseId/zones", "locations.read", W),
  write("PATCH", "/locations/warehouses/:warehouseId/zones/:zoneId", "locations.manage", W),
  write("POST", "/locations/warehouses/:warehouseId/locations", "locations.manage", W),
  get("/locations/warehouses/:warehouseId/locations", "locations.read", W),
  get("/locations/warehouses/:warehouseId/locations/:code", "locations.read", W),
  write("PATCH", "/locations/warehouses/:warehouseId/locations/:code", "locations.manage", W),
  // Reference data shared by every warehouse.
  get("/locations/location-types", "locations.read"),
  write("POST", "/locations/location-types", "locations.manage"),
  get("/locations/storage-classes", "locations.read"),
  write("POST", "/locations/storage-classes", "locations.manage"),
];

export const catalogRules: Rule[] = [
  get("/catalog/uoms", "catalog.read"),
  write("POST", "/catalog/uoms", "catalog.manage"),
  get("/catalog/categories", "catalog.read"),
  write("POST", "/catalog/categories", "catalog.manage"),
  write("PATCH", "/catalog/categories/:code", "catalog.manage"),
  write("POST", "/catalog/items", "catalog.manage"),
  get("/catalog/items", "catalog.read"),
  get("/catalog/items/:sku", "catalog.read"),
  write("PATCH", "/catalog/items/:sku", "catalog.manage"),
  get("/catalog/items/:sku/units", "catalog.read"),
  write("POST", "/catalog/items/:sku/units", "catalog.manage"),
  write("PATCH", "/catalog/items/:sku/units/:uom", "catalog.manage"),
  write("POST", "/catalog/items/:sku/barcodes", "catalog.manage"),
  get("/catalog/items/:sku/barcodes", "catalog.read"),
  write("DELETE", "/catalog/items/:sku/barcodes/:barcode", "catalog.manage"),
  get("/catalog/barcodes/:barcode", "catalog.read"),
];

export const identityRules: Rule[] = [
  { method: "POST", path: "/identity/login", access: "public" },
  // The caller's own session, profile and password: any signed-in user.
  { method: "POST", path: "/identity/logout", access: "signed-in" },
  { method: "GET", path: "/identity/me", access: "signed-in" },
  { method: "PUT", path: "/identity/me/password", access: "signed-in" },
  // Looking at users, roles and access.
  get("/identity/permissions", "identity.users.read"),
  get("/identity/roles", "identity.users.read"),
  get("/identity/users", "identity.users.read"),
  get("/identity/users/:id", "identity.users.read"),
  get("/identity/users/:id/roles", "identity.users.read"),
  get("/identity/users/:id/warehouses", "identity.users.read"),
  get("/identity/users/:id/access", "identity.users.read"),
  // Managing accounts.
  write("POST", "/identity/users", "identity.users.manage"),
  write("PATCH", "/identity/users/:id", "identity.users.manage"),
  write("PUT", "/identity/users/:id/password", "identity.users.manage"),
  // Managing what an account may do and where, and ending its sessions.
  write("PUT", "/identity/users/:id/roles/:role", "identity.access.manage"),
  write("DELETE", "/identity/users/:id/roles/:role", "identity.access.manage"),
  write("PUT", "/identity/users/:id/warehouses/:warehouseId", "identity.access.manage"),
  write("DELETE", "/identity/users/:id/warehouses/:warehouseId", "identity.access.manage"),
  write("DELETE", "/identity/users/:id/sessions", "identity.access.manage"),
];

export const auditRules: Rule[] = [get("/audit/entries", "audit.read")];

/** Health probes are mounted before this layer and need no rule. */
export const accessRules: Rule[] = [
  ...inventoryRules,
  ...locationsRules,
  ...catalogRules,
  ...identityRules,
  ...auditRules,
];
