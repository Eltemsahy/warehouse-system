// PUBLIC INTERFACE of the catalog module. Other modules import ONLY from here.
import { BarcodeService } from "./application/barcode-service.js";
import { CategoryService } from "./application/category-service.js";
import { ItemService } from "./application/item-service.js";
import type { CatalogRepository } from "./application/ports.js";
import { CatalogQueries } from "./application/queries.js";
import { UomService } from "./application/uom-service.js";
import { catalogRoutes } from "./api/routes.js";
import { InMemoryCatalogRepository } from "./infrastructure/in-memory-catalog-repository.js";

export function createCatalogModule(deps: { repository?: CatalogRepository } = {}) {
  const repository = deps.repository ?? new InMemoryCatalogRepository();
  const items = new ItemService(repository);
  const categories = new CategoryService(repository);
  const uoms = new UomService(repository);
  const barcodes = new BarcodeService(repository);
  const queries = new CatalogQueries(repository);
  return {
    router: catalogRoutes({ items, categories, uoms, barcodes }),
    items,
    categories,
    uoms,
    barcodes,
    // Public queries used by other modules (P1-5: inventory validates SKUs against them).
    /** Exact, case-sensitive SKU match. */
    getItem: (sku: string) => queries.getItem(sku),
    /** True when the SKU exists and the item is active. */
    exists: (sku: string) => queries.exists(sku),
    /** Which item, and how many base units, does this barcode stand for? */
    resolveBarcode: (barcode: string) => queries.resolveBarcode(barcode),
  };
}

export type { CatalogRepository } from "./application/ports.js";
export type { CatalogItemView, ScannedBarcodeView } from "./application/queries.js";
export { InMemoryCatalogRepository } from "./infrastructure/in-memory-catalog-repository.js";
export { PgCatalogRepository } from "./infrastructure/pg-catalog-repository.js";
