import { describe, expect, it } from "vitest";
import { accessRules } from "../../apps/api/src/access-rules.js";
import { findRule, type Rule } from "../../apps/api/src/security.js";
import { PERMISSIONS } from "../../modules/identity/index.js";

const sample: Rule[] = [
  {
    method: "GET",
    path: "/things/:id/parts/:part",
    access: { permission: "x.read", warehouse: "id" },
  },
  { method: "POST", path: "/things", access: { permission: "x.manage" } },
  { method: "GET", path: "/a.b", access: "signed-in" },
];

describe("findRule", () => {
  it("finds the rule and reads the path parameters", () => {
    const m = findRule(sample, "GET", "/things/W1/parts/P-9");
    expect(m?.rule.path).toBe("/things/:id/parts/:part");
    expect(m?.params).toEqual({ id: "W1", part: "P-9" });
  });

  it("ignores a trailing slash and the case of the path", () => {
    expect(findRule(sample, "GET", "/things/W1/parts/P-9/")?.params).toEqual({
      id: "W1",
      part: "P-9",
    });
    expect(findRule(sample, "POST", "/THINGS")?.rule.path).toBe("/things");
    expect(findRule(sample, "GET", "/Things/W1/Parts/p")?.rule.path).toBe(
      "/things/:id/parts/:part",
    );
  });

  it("treats HEAD as GET, and refuses a method with no rule", () => {
    expect(findRule(sample, "HEAD", "/things/W1/parts/P")).toBeDefined();
    expect(findRule(sample, "DELETE", "/things")).toBeUndefined();
    expect(findRule(sample, "GET", "/things")).toBeUndefined(); // only POST is listed
  });

  it("does not match paths that only look similar", () => {
    for (const path of [
      "/things/W1/parts",
      "/things/W1/parts/P/extra",
      "/prefix/things/W1/parts/P",
      "/things//parts/P",
      "/",
    ]) {
      expect(findRule(sample, "GET", path), path).toBeUndefined();
    }
    expect(findRule(sample, "GET", "/aXb")).toBeUndefined(); // the dot is a dot, not a wildcard
    expect(findRule(sample, "GET", "/a.b")).toBeDefined();
  });

  it("decodes encoded parameters and refuses broken encoding", () => {
    expect(findRule(sample, "GET", "/things/W%201/parts/a%2Fb")?.params).toEqual({
      id: "W 1",
      part: "a/b",
    });
    expect(findRule(sample, "GET", "/things/%E0%A4%A/parts/P")).toBeUndefined();
  });
});

describe("the rule table", () => {
  const known = new Set(PERMISSIONS.map((p) => p.code));
  const shape = (r: Rule) => `${r.method} ${r.path.replace(/:[A-Za-z]+/g, ":")}`;

  it("only names permissions that exist (a typo would lock even administrators out)", () => {
    for (const r of accessRules) {
      if (typeof r.access === "object") expect(known.has(r.access.permission), shape(r)).toBe(true);
    }
  });

  it("has one rule per route", () => {
    const shapes = accessRules.map(shape);
    expect(shapes).toEqual([...new Set(shapes)]);
  });

  it("makes login the only public route", () => {
    expect(accessRules.filter((r) => r.access === "public").map(shape)).toEqual([
      "POST /identity/login",
    ]);
  });

  it("scopes every inventory and locations route that names a warehouse", () => {
    const named = accessRules.filter(
      (r) => /^\/(inventory|locations)\//.test(r.path) && r.path.includes(":warehouseId"),
    );
    expect(named.length).toBeGreaterThanOrEqual(10);
    for (const r of named) {
      expect(typeof r.access === "object" && r.access.warehouse === "warehouseId", shape(r)).toBe(
        true,
      );
    }
  });

  it("only scopes by a parameter the path really has", () => {
    for (const r of accessRules) {
      if (typeof r.access === "object" && r.access.warehouse) {
        expect(r.path.includes(`:${r.access.warehouse}`), shape(r)).toBe(true);
      }
    }
  });

  it("never lets a change be made with a read permission", () => {
    for (const r of accessRules.filter((x) => x.method !== "GET")) {
      if (typeof r.access === "object")
        expect(r.access.permission.endsWith(".read"), shape(r)).toBe(false);
    }
  });

  it("asks for the right permission on the routes that matter most", () => {
    const need = (method: string, path: string) => {
      const a = findRule(accessRules, method, path)?.rule.access;
      return typeof a === "object" ? `${a.permission}${a.warehouse ? " @warehouse" : ""}` : a;
    };
    expect(need("POST", "/inventory/warehouses/w/adjustments")).toBe("inventory.adjust @warehouse");
    expect(need("POST", "/inventory/warehouses/w/transfers")).toBe("inventory.transfer @warehouse");
    expect(need("GET", "/inventory/warehouses/w/skus/s/locations/l/balance")).toBe(
      "inventory.read @warehouse",
    );
    expect(need("POST", "/locations/warehouses")).toBe("locations.manage");
    expect(need("PATCH", "/catalog/items/SKU-1")).toBe("catalog.manage");
    expect(need("PUT", "/identity/users/u/roles/ADMIN")).toBe("identity.access.manage");
    expect(need("PUT", "/identity/users/u/password")).toBe("identity.users.manage");
    expect(need("GET", "/identity/me")).toBe("signed-in");
    expect(need("GET", "/health")).toBeUndefined(); // probes are mounted before the rules
  });
});
