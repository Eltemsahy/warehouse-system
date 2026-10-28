import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type LocationsError } from "../domain/errors.js";
import type { Warehouse, WarehouseStatus } from "../domain/model.js";
import { WAREHOUSE_STATUSES } from "../domain/model.js";
import type { LocationsRepository } from "./ports.js";
import {
  attempt,
  codeProblem,
  isValidTimezone,
  nameProblem,
  newAudit,
  violation,
} from "./support.js";

export interface CreateWarehouseInput {
  code: string;
  name: string;
  address?: string | null;
  /** IANA time zone name. Defaults to "UTC". */
  timezone?: string;
}

export interface UpdateWarehouseInput {
  /** The version the caller last saw (optimistic lock). */
  version: number;
  name?: string;
  address?: string | null;
  timezone?: string;
  status?: WarehouseStatus;
}

export class WarehouseService {
  constructor(private repo: LocationsRepository) {}

  async create(i: CreateWarehouseInput): Promise<Result<Warehouse, LocationsError>> {
    const timezone = i.timezone ?? "UTC";
    const problem =
      codeProblem("warehouse code", i.code) ??
      nameProblem("warehouse name", i.name) ??
      (isValidTimezone(timezone) ? undefined : `unknown time zone "${timezone}"`);
    if (problem) return violation(problem);

    return attempt(() =>
      this.repo.insertWarehouse({
        id: newId(),
        code: i.code,
        name: i.name.trim(),
        address: i.address ?? null,
        timezone,
        status: "ACTIVE",
        ...newAudit(),
      }),
    );
  }

  async get(id: string): Promise<Result<Warehouse, LocationsError>> {
    const found = await this.repo.getWarehouse(id);
    return found ? ok(found) : err(new NotFoundError("warehouse"));
  }

  list(): Promise<Warehouse[]> {
    return this.repo.listWarehouses();
  }

  async update(id: string, i: UpdateWarehouseInput): Promise<Result<Warehouse, LocationsError>> {
    const current = await this.repo.getWarehouse(id);
    if (!current) return err(new NotFoundError("warehouse"));

    const next: Warehouse = {
      ...current,
      name: i.name?.trim() ?? current.name,
      address: i.address === undefined ? current.address : i.address,
      timezone: i.timezone ?? current.timezone,
      status: i.status ?? current.status,
    };
    const problem =
      nameProblem("warehouse name", next.name) ??
      (isValidTimezone(next.timezone) ? undefined : `unknown time zone "${next.timezone}"`) ??
      (WAREHOUSE_STATUSES.includes(next.status) ? undefined : `unknown status "${next.status}"`);
    if (problem) return violation(problem);

    return attempt(() => this.repo.updateWarehouse(next, i.version));
  }
}
