import { newId, type Result } from "../../../shared/kernel/index.js";
import type { CatalogError } from "../domain/errors.js";
import type { Uom } from "../domain/model.js";
import type { CatalogRepository } from "./ports.js";
import { attempt, codeProblem, newAudit, textProblem, violation } from "./support.js";

export interface CreateUomInput {
  code: string;
  name: string;
}

/** Organisation-wide units of measure. The migration seeds EA, CS and PL. */
export class UomService {
  constructor(private repo: CatalogRepository) {}

  list(): Promise<Uom[]> {
    return this.repo.listUoms();
  }

  async create(i: CreateUomInput): Promise<Result<Uom, CatalogError>> {
    const problem = codeProblem("unit code", i.code) ?? textProblem("unit name", i.name, 120);
    if (problem) return violation(problem);
    return attempt(() =>
      this.repo.insertUom({ id: newId(), code: i.code, name: i.name.trim(), ...newAudit() }),
    );
  }
}
