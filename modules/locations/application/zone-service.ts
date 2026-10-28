import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type LocationsError } from "../domain/errors.js";
import { ZONE_TYPES, type Zone, type ZoneType } from "../domain/model.js";
import type { LocationsRepository } from "./ports.js";
import { attempt, codeProblem, newAudit, violation } from "./support.js";

export interface CreateZoneInput {
  code: string;
  type: ZoneType;
}

export interface UpdateZoneInput {
  version: number;
  type?: ZoneType;
  isActive?: boolean;
}

export class ZoneService {
  constructor(private repo: LocationsRepository) {}

  async create(warehouseId: string, i: CreateZoneInput): Promise<Result<Zone, LocationsError>> {
    const problem =
      codeProblem("zone code", i.code) ??
      (ZONE_TYPES.includes(i.type) ? undefined : `unknown zone type "${i.type}"`);
    if (problem) return violation(problem);
    if (!(await this.repo.getWarehouse(warehouseId))) return err(new NotFoundError("warehouse"));

    return attempt(() =>
      this.repo.insertZone({
        id: newId(),
        warehouseId,
        code: i.code,
        type: i.type,
        isActive: true,
        ...newAudit(),
      }),
    );
  }

  async list(warehouseId: string): Promise<Result<Zone[], LocationsError>> {
    if (!(await this.repo.getWarehouse(warehouseId))) return err(new NotFoundError("warehouse"));
    return ok(await this.repo.listZones(warehouseId));
  }

  async update(
    warehouseId: string,
    zoneId: string,
    i: UpdateZoneInput,
  ): Promise<Result<Zone, LocationsError>> {
    const current = await this.repo.getZone(warehouseId, zoneId);
    if (!current) return err(new NotFoundError("zone"));

    const next: Zone = {
      ...current,
      type: i.type ?? current.type,
      isActive: i.isActive ?? current.isActive,
    };
    if (!ZONE_TYPES.includes(next.type)) return violation(`unknown zone type "${next.type}"`);

    return attempt(() => this.repo.updateZone(next, i.version));
  }
}
