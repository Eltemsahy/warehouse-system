import type { LocationStatus } from "../domain/model.js";
import type { LocationsRepository } from "./ports.js";

/** What other modules may know about a warehouse. */
export interface WarehouseView {
  id: string;
  code: string;
  name: string;
  timezone: string;
  isActive: boolean;
}

/** What other modules may know about a location. */
export interface LocationView {
  id: string;
  warehouseId: string;
  code: string;
  zoneId: string | null;
  /** Location type code, for example "BIN". */
  type: string;
  isPickable: boolean;
  isStorable: boolean;
  isStaging: boolean;
  status: LocationStatus;
  isActive: boolean;
}

/** The module's public, read-only queries (Implementation Plan P1-3, used by P1-5). */
export class LocationsQueries {
  constructor(private repo: LocationsRepository) {}

  async getWarehouse(warehouseId: string): Promise<WarehouseView | null> {
    const w = await this.repo.getWarehouse(warehouseId);
    return w
      ? {
          id: w.id,
          code: w.code,
          name: w.name,
          timezone: w.timezone,
          isActive: w.status === "ACTIVE",
        }
      : null;
  }

  /** Exact, case-sensitive code match within the warehouse (ADR 0004). */
  async getLocation(warehouseId: string, code: string): Promise<LocationView | null> {
    const l = await this.repo.getLocation(warehouseId, code);
    return l
      ? {
          id: l.id,
          warehouseId: l.warehouseId,
          code: l.code,
          zoneId: l.zoneId,
          type: l.type.code,
          isPickable: l.type.isPickable,
          isStorable: l.type.isStorable,
          isStaging: l.type.isStaging,
          status: l.status,
          isActive: l.isActive,
        }
      : null;
  }

  /** True when the location exists, is active, and its warehouse is active. */
  async exists(warehouseId: string, code: string): Promise<boolean> {
    const [warehouse, location] = await Promise.all([
      this.repo.getWarehouse(warehouseId),
      this.repo.getLocation(warehouseId, code),
    ]);
    return warehouse?.status === "ACTIVE" && location?.isActive === true;
  }
}
