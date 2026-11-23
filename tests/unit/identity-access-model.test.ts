import { describe, expect, it } from "vitest";
import {
  can,
  PERMISSIONS,
  SYSTEM_ROLES,
  type UserAccess,
} from "../../modules/identity/domain/model.js";

const W1 = "11111111-1111-4111-8111-111111111111";
const W2 = "22222222-2222-4222-8222-222222222222";

describe("can", () => {
  const picker: UserAccess = {
    permissions: ["inventory.read"],
    allWarehouses: false,
    warehouseIds: [W1],
  };

  it("needs the permission", () => {
    expect(can(picker, "inventory.read")).toBe(true);
    expect(can(picker, "inventory.adjust")).toBe(false);
  });

  it("needs access to the warehouse when the action belongs to one", () => {
    expect(can(picker, "inventory.read", W1)).toBe(true);
    expect(can(picker, "inventory.read", W1.toUpperCase())).toBe(true);
    expect(can(picker, "inventory.read", W2)).toBe(false);
  });

  it("never grants a warehouse without the permission", () => {
    expect(can(picker, "inventory.adjust", W1)).toBe(false);
  });

  it("lets all-warehouse holders act anywhere, but still needs the permission", () => {
    const admin: UserAccess = {
      permissions: ["inventory.read"],
      allWarehouses: true,
      warehouseIds: [],
    };
    expect(can(admin, "inventory.read", W2)).toBe(true);
    expect(can(admin, "inventory.adjust", W2)).toBe(false);
  });
});

describe("the seeded roles", () => {
  const known = new Set(PERMISSIONS.map((p) => p.code));

  it("only use permissions that exist", () => {
    for (const role of SYSTEM_ROLES) {
      for (const code of role.permissions)
        expect(known.has(code), `${role.code}: ${code}`).toBe(true);
    }
  });

  it("give ADMIN every permission, and all warehouses to ADMIN alone", () => {
    expect(SYSTEM_ROLES.find((r) => r.code === "ADMIN")?.permissions).toEqual([...known].sort());
    expect(SYSTEM_ROLES.filter((r) => r.allWarehouses).map((r) => r.code)).toEqual(["ADMIN"]);
  });

  it("keep user and access management away from the shop-floor roles", () => {
    const floor = ["RECEIVER", "PUTAWAY_OPERATOR", "PICKER", "PACKER", "INVENTORY_CONTROLLER"];
    for (const role of SYSTEM_ROLES.filter((r) => floor.includes(r.code))) {
      expect(
        role.permissions.filter((p) => p.startsWith("identity.")),
        role.code,
      ).toEqual([]);
    }
  });

  it("have unique codes, listed in order, and sorted permissions", () => {
    const codes = SYSTEM_ROLES.map((r) => r.code);
    expect(codes).toEqual([...new Set(codes)].sort());
    for (const role of SYSTEM_ROLES) expect(role.permissions).toEqual([...role.permissions].sort());
  });

  it("derive resource and action from the permission code", () => {
    expect(PERMISSIONS.find((p) => p.code === "identity.access.manage")).toEqual({
      code: "identity.access.manage",
      resource: "identity.access",
      action: "manage",
    });
  });
});
