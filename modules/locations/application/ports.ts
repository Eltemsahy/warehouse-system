import type {
  Location,
  LocationStatus,
  LocationType,
  StorageClass,
  Warehouse,
  Zone,
} from "../domain/model.js";

export interface LocationFilter {
  zoneId?: string;
  typeCode?: string;
  status?: LocationStatus;
  isActive?: boolean;
  /** Keyset pagination: only locations whose code sorts after this one. */
  after?: string;
  limit: number;
}

export interface LocationPage {
  items: Location[];
  /** Pass as `after` to get the next page; null on the last page. */
  nextAfter: string | null;
}

/**
 * Persistence for the locations module. Every adapter must pass
 * tests/contract/locations-repository.contract.ts. Errors every adapter throws:
 * - insert*: ConflictError for a duplicate code (compared case-insensitively),
 *   RuleViolationError when a referenced warehouse, zone, type or class is missing, or a
 *   zone belongs to another warehouse.
 * - update*: NotFoundError when the row is missing, ConflictError when `expectedVersion`
 *   is stale. Updates never change a code or a warehouse (ADR 0004).
 */
export interface LocationsRepository {
  insertWarehouse(w: Warehouse): Promise<Warehouse>;
  getWarehouse(id: string): Promise<Warehouse | null>;
  listWarehouses(): Promise<Warehouse[]>;
  updateWarehouse(w: Warehouse, expectedVersion: number): Promise<Warehouse>;

  insertZone(z: Zone): Promise<Zone>;
  getZone(warehouseId: string, zoneId: string): Promise<Zone | null>;
  listZones(warehouseId: string): Promise<Zone[]>;
  updateZone(z: Zone, expectedVersion: number): Promise<Zone>;

  insertLocation(l: Location): Promise<Location>;
  /** Exact, case-sensitive match on the code (ADR 0004). */
  getLocation(warehouseId: string, code: string): Promise<Location | null>;
  listLocations(warehouseId: string, filter: LocationFilter): Promise<LocationPage>;
  updateLocation(l: Location, expectedVersion: number): Promise<Location>;

  listLocationTypes(): Promise<LocationType[]>;
  /** Case-insensitive. */
  getLocationTypeByCode(code: string): Promise<LocationType | null>;
  insertLocationType(t: LocationType): Promise<LocationType>;

  listStorageClasses(): Promise<StorageClass[]>;
  /** Case-insensitive; unknown codes are simply missing from the result. */
  getStorageClassesByCodes(codes: string[]): Promise<StorageClass[]>;
  insertStorageClass(c: StorageClass): Promise<StorageClass>;
}
