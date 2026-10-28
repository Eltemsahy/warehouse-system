import { newId, type Result } from "../../../shared/kernel/index.js";
import type { LocationsError } from "../domain/errors.js";
import type { LocationType, StorageClass } from "../domain/model.js";
import type { LocationsRepository } from "./ports.js";
import { attempt, codeProblem, nameProblem, newAudit, violation } from "./support.js";

export interface CreateLocationTypeInput {
  code: string;
  name: string;
  isPickable?: boolean;
  isStorable?: boolean;
  isStaging?: boolean;
}

export interface CreateStorageClassInput {
  code: string;
  name: string;
}

/** Organisation-wide reference data. The migration seeds the common values. */
export class ReferenceDataService {
  constructor(private repo: LocationsRepository) {}

  listLocationTypes(): Promise<LocationType[]> {
    return this.repo.listLocationTypes();
  }

  async createLocationType(
    i: CreateLocationTypeInput,
  ): Promise<Result<LocationType, LocationsError>> {
    const problem = codeProblem("type code", i.code) ?? nameProblem("type name", i.name);
    if (problem) return violation(problem);
    return attempt(() =>
      this.repo.insertLocationType({
        id: newId(),
        code: i.code,
        name: i.name.trim(),
        isPickable: i.isPickable ?? false,
        isStorable: i.isStorable ?? false,
        isStaging: i.isStaging ?? false,
        ...newAudit(),
      }),
    );
  }

  listStorageClasses(): Promise<StorageClass[]> {
    return this.repo.listStorageClasses();
  }

  async createStorageClass(
    i: CreateStorageClassInput,
  ): Promise<Result<StorageClass, LocationsError>> {
    const problem =
      codeProblem("storage class code", i.code) ?? nameProblem("storage class name", i.name);
    if (problem) return violation(problem);
    return attempt(() =>
      this.repo.insertStorageClass({
        id: newId(),
        code: i.code,
        name: i.name.trim(),
        ...newAudit(),
      }),
    );
  }
}
