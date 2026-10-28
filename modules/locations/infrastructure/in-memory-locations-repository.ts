import { newId } from "../../../shared/kernel/index.js";
import type { LocationFilter, LocationPage, LocationsRepository } from "../application/ports.js";
import { ConflictError, NotFoundError, RuleViolationError } from "../domain/errors.js";
import {
  DEFAULT_LOCATION_TYPES,
  DEFAULT_STORAGE_CLASSES,
  type Location,
  type LocationType,
  type StorageClass,
  type Warehouse,
  type Zone,
} from "../domain/model.js";

const lower = (s: string) => s.toLowerCase();
const byCode = <T extends { code: string }>(a: T, b: T) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
const copy = <T>(value: T): T => structuredClone(value);

/** For tests and local development. Honours the same contract as PgLocationsRepository. */
export class InMemoryLocationsRepository implements LocationsRepository {
  private warehouses = new Map<string, Warehouse>();
  private zones = new Map<string, Zone>();
  private locations = new Map<string, Location>();
  private types = new Map<string, LocationType>();
  private classes = new Map<string, StorageClass>();

  /** `seed` loads the same reference data that migration 006 inserts. */
  constructor(seed = true) {
    if (!seed) return;
    const now = new Date();
    const audit = { createdAt: now, updatedAt: now, createdBy: null, updatedBy: null, version: 1 };
    for (const t of DEFAULT_LOCATION_TYPES) {
      const id = newId();
      this.types.set(id, { id, ...t, ...audit });
    }
    for (const c of DEFAULT_STORAGE_CLASSES) {
      const id = newId();
      this.classes.set(id, { id, ...c, ...audit });
    }
  }

  // ---- warehouses

  async insertWarehouse(w: Warehouse) {
    if ([...this.warehouses.values()].some((x) => lower(x.code) === lower(w.code))) {
      throw new ConflictError("a warehouse with this code already exists");
    }
    return this.store(this.warehouses, { ...copy(w), ...this.fresh() });
  }

  async getWarehouse(id: string) {
    return copyOrNull(this.warehouses.get(id));
  }

  async listWarehouses() {
    return [...this.warehouses.values()].sort(byCode).map(copy);
  }

  async updateWarehouse(w: Warehouse, expectedVersion: number) {
    const current = this.requireVersion(this.warehouses, w.id, "warehouse", expectedVersion);
    return this.store(this.warehouses, {
      ...current,
      name: w.name,
      address: w.address,
      timezone: w.timezone,
      status: w.status,
      ...this.touched(w.updatedBy, current.version),
    });
  }

  // ---- zones

  async insertZone(z: Zone) {
    if (!this.warehouses.has(z.warehouseId)) {
      throw new RuleViolationError("the warehouse does not exist");
    }
    if (
      [...this.zones.values()].some(
        (x) => x.warehouseId === z.warehouseId && lower(x.code) === lower(z.code),
      )
    ) {
      throw new ConflictError("a zone with this code already exists in the warehouse");
    }
    return this.store(this.zones, { ...copy(z), ...this.fresh() });
  }

  async getZone(warehouseId: string, zoneId: string) {
    const z = this.zones.get(zoneId);
    return z && z.warehouseId === warehouseId ? copy(z) : null;
  }

  async listZones(warehouseId: string) {
    return [...this.zones.values()]
      .filter((z) => z.warehouseId === warehouseId)
      .sort(byCode)
      .map(copy);
  }

  async updateZone(z: Zone, expectedVersion: number) {
    const current = this.requireVersion(this.zones, z.id, "zone", expectedVersion);
    return this.store(this.zones, {
      ...current,
      type: z.type,
      isActive: z.isActive,
      ...this.touched(z.updatedBy, current.version),
    });
  }

  // ---- locations

  async insertLocation(l: Location) {
    this.checkLocationReferences(l);
    if (
      [...this.locations.values()].some(
        (x) => x.warehouseId === l.warehouseId && lower(x.code) === lower(l.code),
      )
    ) {
      throw new ConflictError("a location with this code already exists in the warehouse");
    }
    return this.store(this.locations, { ...copy(l), ...this.fresh() });
  }

  async getLocation(warehouseId: string, code: string) {
    for (const l of this.locations.values()) {
      if (l.warehouseId === warehouseId && l.code === code) return copy(l);
    }
    return null;
  }

  async listLocations(warehouseId: string, filter: LocationFilter): Promise<LocationPage> {
    const rows = [...this.locations.values()]
      .filter((l) => l.warehouseId === warehouseId)
      .filter((l) => filter.zoneId === undefined || l.zoneId === filter.zoneId)
      .filter((l) => filter.typeCode === undefined || lower(l.type.code) === lower(filter.typeCode))
      .filter((l) => filter.status === undefined || l.status === filter.status)
      .filter((l) => filter.isActive === undefined || l.isActive === filter.isActive)
      .filter((l) => filter.after === undefined || l.code > filter.after)
      .sort(byCode);
    const items = rows.slice(0, filter.limit).map(copy);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.code : null };
  }

  async updateLocation(l: Location, expectedVersion: number) {
    const current = this.requireVersion(this.locations, l.id, "location", expectedVersion);
    this.checkLocationReferences({ ...l, warehouseId: current.warehouseId });
    return this.store(this.locations, {
      ...current,
      zoneId: l.zoneId,
      type: copy(l.type),
      aisle: l.aisle,
      bay: l.bay,
      level: l.level,
      position: l.position,
      status: l.status,
      isActive: l.isActive,
      capacity: copy(l.capacity),
      storageClasses: copy(l.storageClasses),
      ...this.touched(l.updatedBy, current.version),
    });
  }

  // ---- reference data

  async listLocationTypes() {
    return [...this.types.values()].sort(byCode).map(copy);
  }

  async getLocationTypeByCode(code: string) {
    for (const t of this.types.values()) if (lower(t.code) === lower(code)) return copy(t);
    return null;
  }

  async insertLocationType(t: LocationType) {
    if ([...this.types.values()].some((x) => lower(x.code) === lower(t.code))) {
      throw new ConflictError("a location type with this code already exists");
    }
    return this.store(this.types, { ...copy(t), ...this.fresh() });
  }

  async listStorageClasses() {
    return [...this.classes.values()].sort(byCode).map(copy);
  }

  async getStorageClassesByCodes(codes: string[]) {
    const wanted = new Set(codes.map(lower));
    return [...this.classes.values()].filter((c) => wanted.has(lower(c.code))).map(copy);
  }

  async insertStorageClass(c: StorageClass) {
    if ([...this.classes.values()].some((x) => lower(x.code) === lower(c.code))) {
      throw new ConflictError("a storage class with this code already exists");
    }
    return this.store(this.classes, { ...copy(c), ...this.fresh() });
  }

  // ---- helpers

  private fresh() {
    const now = new Date();
    return { createdAt: now, updatedAt: now, version: 1 };
  }

  private touched(updatedBy: string | null, version: number) {
    return { updatedAt: new Date(), updatedBy, version: version + 1 };
  }

  private store<T extends { id: string }>(table: Map<string, T>, row: T): T {
    table.set(row.id, row);
    return copy(row);
  }

  private requireVersion<T extends { id: string; version: number }>(
    table: Map<string, T>,
    id: string,
    what: string,
    expectedVersion: number,
  ): T {
    const current = table.get(id);
    if (!current) throw new NotFoundError(what);
    if (current.version !== expectedVersion) {
      throw new ConflictError(
        `the ${what} was changed by someone else (expected version ${expectedVersion}, found ${current.version})`,
      );
    }
    return current;
  }

  private checkLocationReferences(l: Location) {
    if (!this.warehouses.has(l.warehouseId)) {
      throw new RuleViolationError("the warehouse does not exist");
    }
    if (l.zoneId !== null) {
      const zone = this.zones.get(l.zoneId);
      if (!zone || zone.warehouseId !== l.warehouseId) {
        throw new RuleViolationError("the zone does not exist in this warehouse");
      }
    }
    if (!this.types.has(l.type.id))
      throw new RuleViolationError("the location type does not exist");
    for (const c of l.storageClasses) {
      if (!this.classes.has(c.id)) throw new RuleViolationError("a storage class does not exist");
    }
  }
}

function copyOrNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : copy(value);
}
