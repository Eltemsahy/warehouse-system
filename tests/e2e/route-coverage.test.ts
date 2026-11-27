import { describe, expect, it } from "vitest";
import { accessRules } from "../../apps/api/src/access-rules.js";
import { auditRoutes } from "../../apps/api/src/audit-routes.js";
import { findRule } from "../../apps/api/src/security.js";
import { InMemoryAuditTrail } from "../../shared/audit/index.js";
import { InMemoryOutbox } from "../../shared/events/index.js";
import { createCatalogModule, InMemoryCatalogRepository } from "../../modules/catalog/index.js";
import { createIdentityModule } from "../../modules/identity/index.js";
import {
  createInventoryModule,
  InMemoryLedger,
  MasterDataReferences,
} from "../../modules/inventory/index.js";
import {
  createLocationsModule,
  InMemoryLocationsRepository,
} from "../../modules/locations/index.js";

// The rules in access-rules.ts and the routes the modules register must be the same list. A route
// without a rule can never be reached (protect answers 404), a rule without a route is stale.
// This reads the routers' own route tables, so it breaks the build the day someone adds a route
// and forgets the rule.

interface Route {
  method: string;
  path: string;
}

/** The part of an Express router's own route table that this test reads. */
interface RouteLayer {
  route?: { path: unknown; methods: Record<string, boolean> };
}

/** The routes of an Express router, under the prefix it is mounted at in apps/api/src/app.ts. */
function routesOf(router: unknown, prefix: string): Route[] {
  const stack = (router as { stack?: RouteLayer[] }).stack ?? [];
  const found: Route[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (method === "_all") continue;
      found.push({ method: method.toUpperCase(), path: prefix + String(layer.route.path) });
    }
  }
  return found;
}

const locations = createLocationsModule({ repository: new InMemoryLocationsRepository() });
const catalog = createCatalogModule({ repository: new InMemoryCatalogRepository() });
const inventory = createInventoryModule({
  ledger: new InMemoryLedger(new InMemoryOutbox()),
  references: new MasterDataReferences(locations, catalog),
});
const identity = createIdentityModule();

const routes: Route[] = [
  ...routesOf(inventory.router, "/inventory"),
  ...routesOf(locations.router, "/locations"),
  ...routesOf(catalog.router, "/catalog"),
  ...routesOf(identity.router, "/identity"),
  ...routesOf(auditRoutes(new InMemoryAuditTrail()), "/audit"),
];

const shape = (r: Route) => `${r.method} ${r.path.replace(/:[A-Za-z]+/g, ":")}`;
const sample = (path: string) => path.replace(/:[A-Za-z]+/g, "x");

describe("access rules cover the routes", () => {
  it("can read the routers' route tables", () => {
    expect(routes.length).toBeGreaterThanOrEqual(45);
  });

  it("has a rule for every route a module registers", () => {
    const uncovered = routes.filter((r) => !findRule(accessRules, r.method, sample(r.path)));
    expect(uncovered.map(shape)).toEqual([]);
  });

  it("has no rule for a route that does not exist", () => {
    const real = new Set(routes.map(shape));
    const stale = accessRules.filter((r) => !real.has(shape(r)));
    expect(stale.map(shape)).toEqual([]);
  });
});
