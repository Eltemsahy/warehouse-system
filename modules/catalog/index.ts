// PUBLIC INTERFACE of the catalog module. Other modules import ONLY from here.
// P1-4 is built in steps. This one adds the services and the HTTP API for items, units,
// categories and units of measure. Barcode endpoints and the public queries (getItem, exists,
// resolveBarcode) arrive in the next step.
import { CategoryService } from "./application/category-service.js";
import { ItemService } from "./application/item-service.js";
import type { CatalogRepository } from "./application/ports.js";
import { UomService } from "./application/uom-service.js";
import { catalogRoutes } from "./api/routes.js";
import { InMemoryCatalogRepository } from "./infrastructure/in-memory-catalog-repository.js";

export function createCatalogModule(deps: { repository?: CatalogRepository } = {}) {
  const repository = deps.repository ?? new InMemoryCatalogRepository();
  const items = new ItemService(repository);
  const categories = new CategoryService(repository);
  const uoms = new UomService(repository);
  return { router: catalogRoutes({ items, categories, uoms }), items, categories, uoms };
}

export type { CatalogRepository } from "./application/ports.js";
export { InMemoryCatalogRepository } from "./infrastructure/in-memory-catalog-repository.js";
export { PgCatalogRepository } from "./infrastructure/pg-catalog-repository.js";
