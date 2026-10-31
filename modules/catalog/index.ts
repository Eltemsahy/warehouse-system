// PUBLIC INTERFACE of the catalog module. Other modules import ONLY from here.
// P1-4 is built in steps: this one exposes the repositories only. The services, the API and the
// public queries (getItem, exists, resolveBarcode) arrive in a later step.
export const MODULE_NAME = "catalog" as const;

export type { CatalogRepository } from "./application/ports.js";
export { InMemoryCatalogRepository } from "./infrastructure/in-memory-catalog-repository.js";
export { PgCatalogRepository } from "./infrastructure/pg-catalog-repository.js";
