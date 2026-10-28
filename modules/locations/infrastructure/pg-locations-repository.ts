import type { Pool, PoolClient } from "pg";
import type { LocationFilter, LocationPage, LocationsRepository } from "../application/ports.js";
import {
  ConflictError,
  LocationsError,
  NotFoundError,
  RuleViolationError,
} from "../domain/errors.js";
import type {
  Audited,
  Location,
  LocationStatus,
  LocationType,
  StorageClass,
  StorageClassRef,
  Warehouse,
  WarehouseStatus,
  Zone,
  ZoneType,
} from "../domain/model.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** Turns a database constraint failure into the module's own error. Always throws. */
function translate(e: unknown, duplicate: string, reference: string): never {
  const code = (e as { code?: string }).code;
  if (code === UNIQUE_VIOLATION) throw new ConflictError(duplicate);
  if (code === FOREIGN_KEY_VIOLATION) throw new RuleViolationError(reference);
  throw e;
}

interface AuditRow {
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  version: number;
}

const audit = (r: AuditRow): Audited => ({
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  version: r.version,
});

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected the statement to return a row");
  return row;
}

interface WarehouseRow extends AuditRow {
  id: string;
  code: string;
  name: string;
  address: string | null;
  timezone: string;
  status: WarehouseStatus;
}

const toWarehouse = (r: WarehouseRow): Warehouse => ({
  id: r.id,
  code: r.code,
  name: r.name,
  address: r.address,
  timezone: r.timezone,
  status: r.status,
  ...audit(r),
});

interface ZoneRow extends AuditRow {
  id: string;
  warehouse_id: string;
  code: string;
  type: ZoneType;
  is_active: boolean;
}

const toZone = (r: ZoneRow): Zone => ({
  id: r.id,
  warehouseId: r.warehouse_id,
  code: r.code,
  type: r.type,
  isActive: r.is_active,
  ...audit(r),
});

interface LocationTypeRow extends AuditRow {
  id: string;
  code: string;
  name: string;
  is_pickable: boolean;
  is_storable: boolean;
  is_staging: boolean;
}

const toLocationType = (r: LocationTypeRow): LocationType => ({
  id: r.id,
  code: r.code,
  name: r.name,
  isPickable: r.is_pickable,
  isStorable: r.is_storable,
  isStaging: r.is_staging,
  ...audit(r),
});

interface StorageClassRow extends AuditRow {
  id: string;
  code: string;
  name: string;
}

const toStorageClass = (r: StorageClassRow): StorageClass => ({
  id: r.id,
  code: r.code,
  name: r.name,
  ...audit(r),
});

interface LocationRow extends AuditRow {
  id: string;
  warehouse_id: string;
  zone_id: string | null;
  code: string;
  aisle: string | null;
  bay: string | null;
  level: string | null;
  position: string | null;
  status: LocationStatus;
  is_active: boolean;
  type_id: string;
  type_code: string;
  is_pickable: boolean;
  is_storable: boolean;
  is_staging: boolean;
  has_capacity: boolean;
  max_units: number | null;
  max_weight: string | null; // numeric comes back as text
  max_volume: string | null;
  max_lpns: number | null;
  storage_classes: StorageClassRef[];
}

const num = (v: string | null) => (v === null ? null : Number(v));

const toLocation = (r: LocationRow): Location => ({
  id: r.id,
  warehouseId: r.warehouse_id,
  zoneId: r.zone_id,
  code: r.code,
  type: {
    id: r.type_id,
    code: r.type_code,
    isPickable: r.is_pickable,
    isStorable: r.is_storable,
    isStaging: r.is_staging,
  },
  aisle: r.aisle,
  bay: r.bay,
  level: r.level,
  position: r.position,
  status: r.status,
  isActive: r.is_active,
  capacity: r.has_capacity
    ? {
        maxUnits: r.max_units,
        maxWeight: num(r.max_weight),
        maxVolume: num(r.max_volume),
        maxLpns: r.max_lpns,
      }
    : null,
  storageClasses: r.storage_classes,
  ...audit(r),
});

const LOCATION_SELECT = `
  SELECT l.id, l.warehouse_id, l.zone_id, l.code, l.aisle, l.bay, l.level, l.position,
         l.status, l.is_active, l.created_at, l.updated_at, l.created_by, l.updated_by, l.version,
         t.id AS type_id, t.code AS type_code, t.is_pickable, t.is_storable, t.is_staging,
         (c.location_id IS NOT NULL) AS has_capacity,
         c.max_units, c.max_weight, c.max_volume, c.max_lpns,
         COALESCE(
           (SELECT json_agg(json_build_object('id', sc.id, 'code', sc.code)
                            ORDER BY sc.code COLLATE "C")
              FROM locations.location_storage_class lsc
              JOIN locations.storage_class sc ON sc.id = lsc.storage_class_id
             WHERE lsc.location_id = l.id),
           '[]'::json) AS storage_classes
    FROM locations.location l
    JOIN locations.location_type t ON t.id = l.location_type_id
    LEFT JOIN locations.location_capacity c ON c.location_id = l.id`;

export class PgLocationsRepository implements LocationsRepository {
  constructor(private pool: Pool) {}

  // ---- warehouses

  async insertWarehouse(w: Warehouse): Promise<Warehouse> {
    try {
      const { rows } = await this.pool.query<WarehouseRow>(
        `INSERT INTO locations.warehouse (id, code, name, address, timezone, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [w.id, w.code, w.name, w.address, w.timezone, w.status, w.createdBy],
      );
      return toWarehouse(first(rows));
    } catch (e) {
      return translate(e, "a warehouse with this code already exists", "invalid warehouse");
    }
  }

  async getWarehouse(id: string): Promise<Warehouse | null> {
    const { rows } = await this.pool.query<WarehouseRow>(
      "SELECT * FROM locations.warehouse WHERE id = $1",
      [id],
    );
    return rows[0] ? toWarehouse(rows[0]) : null;
  }

  async listWarehouses(): Promise<Warehouse[]> {
    const { rows } = await this.pool.query<WarehouseRow>(
      'SELECT * FROM locations.warehouse ORDER BY code COLLATE "C"',
    );
    return rows.map(toWarehouse);
  }

  async updateWarehouse(w: Warehouse, expectedVersion: number): Promise<Warehouse> {
    const { rows } = await this.pool.query<WarehouseRow>(
      `UPDATE locations.warehouse
          SET name = $2, address = $3, timezone = $4, status = $5,
              updated_by = $6, updated_at = now(), version = version + 1
        WHERE id = $1 AND version = $7
        RETURNING *`,
      [w.id, w.name, w.address, w.timezone, w.status, w.updatedBy, expectedVersion],
    );
    if (!rows[0])
      throw await this.staleOrMissing("locations.warehouse", w.id, "warehouse", expectedVersion);
    return toWarehouse(rows[0]);
  }

  // ---- zones

  async insertZone(z: Zone): Promise<Zone> {
    try {
      const { rows } = await this.pool.query<ZoneRow>(
        `INSERT INTO locations.zone (id, warehouse_id, code, type, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [z.id, z.warehouseId, z.code, z.type, z.isActive, z.createdBy],
      );
      return toZone(first(rows));
    } catch (e) {
      return translate(
        e,
        "a zone with this code already exists in the warehouse",
        "the warehouse does not exist",
      );
    }
  }

  async getZone(warehouseId: string, zoneId: string): Promise<Zone | null> {
    const { rows } = await this.pool.query<ZoneRow>(
      "SELECT * FROM locations.zone WHERE id = $1 AND warehouse_id = $2",
      [zoneId, warehouseId],
    );
    return rows[0] ? toZone(rows[0]) : null;
  }

  async listZones(warehouseId: string): Promise<Zone[]> {
    const { rows } = await this.pool.query<ZoneRow>(
      'SELECT * FROM locations.zone WHERE warehouse_id = $1 ORDER BY code COLLATE "C"',
      [warehouseId],
    );
    return rows.map(toZone);
  }

  async updateZone(z: Zone, expectedVersion: number): Promise<Zone> {
    const { rows } = await this.pool.query<ZoneRow>(
      `UPDATE locations.zone
          SET type = $2, is_active = $3, updated_by = $4, updated_at = now(), version = version + 1
        WHERE id = $1 AND version = $5
        RETURNING *`,
      [z.id, z.type, z.isActive, z.updatedBy, expectedVersion],
    );
    if (!rows[0]) throw await this.staleOrMissing("locations.zone", z.id, "zone", expectedVersion);
    return toZone(rows[0]);
  }

  // ---- locations

  async insertLocation(l: Location): Promise<Location> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO locations.location
           (id, warehouse_id, zone_id, location_type_id, code, aisle, bay, level, position,
            status, is_active, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          l.id,
          l.warehouseId,
          l.zoneId,
          l.type.id,
          l.code,
          l.aisle,
          l.bay,
          l.level,
          l.position,
          l.status,
          l.isActive,
          l.createdBy,
        ],
      );
      await this.writeDetails(client, l);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      translate(
        e,
        "a location with this code already exists in the warehouse",
        "the warehouse, zone, location type or storage class is invalid",
      );
    } finally {
      client.release();
    }
    return this.mustGetById(l.id);
  }

  async getLocation(warehouseId: string, code: string): Promise<Location | null> {
    const { rows } = await this.pool.query<LocationRow>(
      `${LOCATION_SELECT} WHERE l.warehouse_id = $1 AND l.code = $2`,
      [warehouseId, code],
    );
    return rows[0] ? toLocation(rows[0]) : null;
  }

  async listLocations(warehouseId: string, filter: LocationFilter): Promise<LocationPage> {
    const { rows } = await this.pool.query<LocationRow>(
      `${LOCATION_SELECT}
        WHERE l.warehouse_id = $1
          AND ($2::uuid IS NULL OR l.zone_id = $2)
          AND ($3::text IS NULL OR lower(t.code) = lower($3))
          AND ($4::text IS NULL OR l.status = $4)
          AND ($5::boolean IS NULL OR l.is_active = $5)
          AND ($6::text IS NULL OR l.code COLLATE "C" > $6)
        ORDER BY l.code COLLATE "C"
        LIMIT $7`,
      [
        warehouseId,
        filter.zoneId ?? null,
        filter.typeCode ?? null,
        filter.status ?? null,
        filter.isActive ?? null,
        filter.after ?? null,
        filter.limit + 1, // one extra row tells us whether there is another page
      ],
    );
    const items = rows.slice(0, filter.limit).map(toLocation);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.code : null };
  }

  async updateLocation(l: Location, expectedVersion: number): Promise<Location> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const upd = await client.query(
        `UPDATE locations.location
            SET zone_id = $2, location_type_id = $3, aisle = $4, bay = $5, level = $6,
                position = $7, status = $8, is_active = $9,
                updated_by = $10, updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $11`,
        [
          l.id,
          l.zoneId,
          l.type.id,
          l.aisle,
          l.bay,
          l.level,
          l.position,
          l.status,
          l.isActive,
          l.updatedBy,
          expectedVersion,
        ],
      );
      if (upd.rowCount === 0) {
        throw await this.staleOrMissing("locations.location", l.id, "location", expectedVersion);
      }
      await this.writeDetails(client, l);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      if (e instanceof LocationsError) throw e;
      translate(e, "conflicting location", "the zone, location type or storage class is invalid");
    } finally {
      client.release();
    }
    return this.mustGetById(l.id);
  }

  // ---- reference data

  async listLocationTypes(): Promise<LocationType[]> {
    const { rows } = await this.pool.query<LocationTypeRow>(
      'SELECT * FROM locations.location_type ORDER BY code COLLATE "C"',
    );
    return rows.map(toLocationType);
  }

  async getLocationTypeByCode(code: string): Promise<LocationType | null> {
    const { rows } = await this.pool.query<LocationTypeRow>(
      "SELECT * FROM locations.location_type WHERE lower(code) = lower($1)",
      [code],
    );
    return rows[0] ? toLocationType(rows[0]) : null;
  }

  async insertLocationType(t: LocationType): Promise<LocationType> {
    try {
      const { rows } = await this.pool.query<LocationTypeRow>(
        `INSERT INTO locations.location_type
           (id, code, name, is_pickable, is_storable, is_staging, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [t.id, t.code, t.name, t.isPickable, t.isStorable, t.isStaging, t.createdBy],
      );
      return toLocationType(first(rows));
    } catch (e) {
      return translate(e, "a location type with this code already exists", "invalid location type");
    }
  }

  async listStorageClasses(): Promise<StorageClass[]> {
    const { rows } = await this.pool.query<StorageClassRow>(
      'SELECT * FROM locations.storage_class ORDER BY code COLLATE "C"',
    );
    return rows.map(toStorageClass);
  }

  async getStorageClassesByCodes(codes: string[]): Promise<StorageClass[]> {
    const { rows } = await this.pool.query<StorageClassRow>(
      "SELECT * FROM locations.storage_class WHERE lower(code) = ANY($1::text[])",
      [codes.map((c) => c.toLowerCase())],
    );
    return rows.map(toStorageClass);
  }

  async insertStorageClass(c: StorageClass): Promise<StorageClass> {
    try {
      const { rows } = await this.pool.query<StorageClassRow>(
        `INSERT INTO locations.storage_class (id, code, name, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [c.id, c.code, c.name, c.createdBy],
      );
      return toStorageClass(first(rows));
    } catch (e) {
      return translate(e, "a storage class with this code already exists", "invalid storage class");
    }
  }

  // ---- helpers

  /** Replaces the capacity and storage classes of a location, inside the caller's transaction. */
  private async writeDetails(client: PoolClient, l: Location): Promise<void> {
    await client.query("DELETE FROM locations.location_capacity WHERE location_id = $1", [l.id]);
    if (l.capacity) {
      await client.query(
        `INSERT INTO locations.location_capacity
           (location_id, max_units, max_weight, max_volume, max_lpns)
         VALUES ($1, $2, $3, $4, $5)`,
        [l.id, l.capacity.maxUnits, l.capacity.maxWeight, l.capacity.maxVolume, l.capacity.maxLpns],
      );
    }
    await client.query("DELETE FROM locations.location_storage_class WHERE location_id = $1", [
      l.id,
    ]);
    for (const c of l.storageClasses) {
      await client.query(
        "INSERT INTO locations.location_storage_class (location_id, storage_class_id) VALUES ($1, $2)",
        [l.id, c.id],
      );
    }
  }

  private async mustGetById(id: string): Promise<Location> {
    const { rows } = await this.pool.query<LocationRow>(`${LOCATION_SELECT} WHERE l.id = $1`, [id]);
    return toLocation(first(rows));
  }

  /** An update matched no row: either it does not exist or someone else changed it first. */
  private async staleOrMissing(
    table: string,
    id: string,
    what: string,
    expectedVersion: number,
  ): Promise<LocationsError> {
    const { rows } = await this.pool.query<{ version: number }>(
      `SELECT version FROM ${table} WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return new NotFoundError(what);
    return new ConflictError(
      `the ${what} was changed by someone else (expected version ${expectedVersion}, found ${row.version})`,
    );
  }
}
