// PUBLIC INTERFACE of the locations module. Other modules import ONLY from here.
import { LocationService } from "./application/location-service.js";
import type { LocationsRepository } from "./application/ports.js";
import { LocationsQueries } from "./application/queries.js";
import { ReferenceDataService } from "./application/reference-data-service.js";
import { WarehouseService } from "./application/warehouse-service.js";
import { ZoneService } from "./application/zone-service.js";
import { locationsRoutes } from "./api/routes.js";
import { InMemoryLocationsRepository } from "./infrastructure/in-memory-locations-repository.js";

export function createLocationsModule(deps: { repository?: LocationsRepository } = {}) {
  const repository = deps.repository ?? new InMemoryLocationsRepository();
  const warehouses = new WarehouseService(repository);
  const zones = new ZoneService(repository);
  const locations = new LocationService(repository);
  const referenceData = new ReferenceDataService(repository);
  const queries = new LocationsQueries(repository);

  return {
    router: locationsRoutes({ warehouses, zones, locations, referenceData }),
    warehouses,
    zones,
    locations,
    referenceData,
    // Public queries used by other modules (P1-5: inventory validates against them).
    getWarehouse: (warehouseId: string) => queries.getWarehouse(warehouseId),
    getLocation: (warehouseId: string, code: string) => queries.getLocation(warehouseId, code),
    /** True when the location exists, is active, and its warehouse is active. */
    exists: (warehouseId: string, code: string) => queries.exists(warehouseId, code),
  };
}

export type { LocationsRepository } from "./application/ports.js";
export type { LocationView, WarehouseView } from "./application/queries.js";
export { InMemoryLocationsRepository } from "./infrastructure/in-memory-locations-repository.js";
export { PgLocationsRepository } from "./infrastructure/pg-locations-repository.js";
