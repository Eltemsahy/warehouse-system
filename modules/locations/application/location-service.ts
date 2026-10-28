import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, RuleViolationError, type LocationsError } from "../domain/errors.js";
import {
  LOCATION_STATUSES,
  type Location,
  type LocationCapacity,
  type LocationStatus,
  type StorageClassRef,
} from "../domain/model.js";
import type { LocationFilter, LocationPage, LocationsRepository } from "./ports.js";
import {
  attempt,
  codeProblem,
  newAudit,
  normalizeCapacity,
  shortTextProblem,
  violation,
} from "./support.js";

type Text = string | null | undefined;

export interface CreateLocationInput {
  code: string;
  zoneId?: string | null;
  /** Location type code, for example "BIN". */
  type: string;
  aisle?: Text;
  bay?: Text;
  level?: Text;
  position?: Text;
  capacity?: Partial<LocationCapacity> | null;
  /** Storage class codes, for example ["AMBIENT"]. */
  storageClasses?: string[];
}

export interface UpdateLocationInput {
  version: number;
  zoneId?: string | null;
  type?: string;
  aisle?: Text;
  bay?: Text;
  level?: Text;
  position?: Text;
  status?: LocationStatus;
  isActive?: boolean;
  /** Replaces the capacity; null clears it. */
  capacity?: Partial<LocationCapacity> | null;
  /** Replaces the whole set. */
  storageClasses?: string[];
}

export class LocationService {
  constructor(private repo: LocationsRepository) {}

  async create(
    warehouseId: string,
    i: CreateLocationInput,
  ): Promise<Result<Location, LocationsError>> {
    const problem =
      codeProblem("location code", i.code) ??
      shortTextProblem("aisle", i.aisle) ??
      shortTextProblem("bay", i.bay) ??
      shortTextProblem("level", i.level) ??
      shortTextProblem("position", i.position);
    if (problem) return violation(problem);

    const warehouse = await this.repo.getWarehouse(warehouseId);
    if (!warehouse) return err(new NotFoundError("warehouse"));
    if (warehouse.status !== "ACTIVE") return violation("warehouse is inactive");

    const refs = await this.resolve(warehouseId, {
      zoneId: i.zoneId ?? null,
      type: i.type,
      capacity: i.capacity,
      storageClasses: i.storageClasses ?? [],
    });
    if (!refs.ok) return refs;

    return attempt(() =>
      this.repo.insertLocation({
        id: newId(),
        warehouseId,
        code: i.code,
        zoneId: i.zoneId ?? null,
        type: refs.value.type,
        aisle: i.aisle ?? null,
        bay: i.bay ?? null,
        level: i.level ?? null,
        position: i.position ?? null,
        status: "AVAILABLE",
        isActive: true,
        capacity: refs.value.capacity,
        storageClasses: refs.value.storageClasses,
        ...newAudit(),
      }),
    );
  }

  async get(warehouseId: string, code: string): Promise<Result<Location, LocationsError>> {
    const found = await this.repo.getLocation(warehouseId, code);
    return found ? ok(found) : err(new NotFoundError("location"));
  }

  async list(
    warehouseId: string,
    filter: LocationFilter,
  ): Promise<Result<LocationPage, LocationsError>> {
    if (!(await this.repo.getWarehouse(warehouseId))) return err(new NotFoundError("warehouse"));
    return ok(await this.repo.listLocations(warehouseId, filter));
  }

  async update(
    warehouseId: string,
    code: string,
    i: UpdateLocationInput,
  ): Promise<Result<Location, LocationsError>> {
    const current = await this.repo.getLocation(warehouseId, code);
    if (!current) return err(new NotFoundError("location"));

    const problem =
      shortTextProblem("aisle", i.aisle) ??
      shortTextProblem("bay", i.bay) ??
      shortTextProblem("level", i.level) ??
      shortTextProblem("position", i.position) ??
      (i.status === undefined || LOCATION_STATUSES.includes(i.status)
        ? undefined
        : `unknown status "${i.status}"`);
    if (problem) return violation(problem);

    const refs = await this.resolve(warehouseId, {
      zoneId: i.zoneId === undefined ? current.zoneId : i.zoneId,
      type: i.type ?? current.type.code,
      capacity: i.capacity === undefined ? current.capacity : i.capacity,
      storageClasses:
        i.storageClasses ?? current.storageClasses.map((c: StorageClassRef) => c.code),
    });
    if (!refs.ok) return refs;

    const next: Location = {
      ...current,
      zoneId: i.zoneId === undefined ? current.zoneId : i.zoneId,
      type: refs.value.type,
      aisle: i.aisle === undefined ? current.aisle : i.aisle,
      bay: i.bay === undefined ? current.bay : i.bay,
      level: i.level === undefined ? current.level : i.level,
      position: i.position === undefined ? current.position : i.position,
      status: i.status ?? current.status,
      isActive: i.isActive ?? current.isActive,
      capacity: refs.value.capacity,
      storageClasses: refs.value.storageClasses,
    };
    return attempt(() => this.repo.updateLocation(next, i.version));
  }

  /** Checks the zone, type, capacity and storage classes, and turns codes into references. */
  private async resolve(
    warehouseId: string,
    i: {
      zoneId: string | null;
      type: string;
      capacity: Partial<LocationCapacity> | null | undefined;
      storageClasses: string[];
    },
  ): Promise<
    Result<
      {
        type: Location["type"];
        capacity: LocationCapacity | null;
        storageClasses: StorageClassRef[];
      },
      LocationsError
    >
  > {
    if (i.zoneId !== null) {
      const zone = await this.repo.getZone(warehouseId, i.zoneId);
      if (!zone) return violation("zone does not exist in this warehouse");
      if (!zone.isActive) return violation("zone is inactive");
    }

    const type = await this.repo.getLocationTypeByCode(i.type);
    if (!type) return violation(`unknown location type "${i.type}"`);

    let capacity: LocationCapacity | null = null;
    if (i.capacity) {
      const normalized = normalizeCapacity(i.capacity);
      if ("problem" in normalized) return err(new RuleViolationError(normalized.problem));
      capacity = normalized.capacity;
    }

    const wanted = [...new Set(i.storageClasses)];
    const found = await this.repo.getStorageClassesByCodes(wanted);
    const foundCodes = new Set(found.map((c) => c.code.toLowerCase()));
    const missing = wanted.filter((c) => !foundCodes.has(c.toLowerCase()));
    if (missing.length > 0) return violation(`unknown storage class: ${missing.join(", ")}`);

    return ok({
      type: {
        id: type.id,
        code: type.code,
        isPickable: type.isPickable,
        isStorable: type.isStorable,
        isStaging: type.isStaging,
      },
      capacity,
      storageClasses: found
        .map((c) => ({ id: c.id, code: c.code }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    });
  }
}
