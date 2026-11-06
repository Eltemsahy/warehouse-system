import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type CatalogError } from "../domain/errors.js";
import type { ItemCategory } from "../domain/model.js";
import type { CatalogRepository } from "./ports.js";
import { attempt, codeProblem, newAudit, textProblem, violation } from "./support.js";

export type CategoryView = ItemCategory & { parentCode: string | null };

export interface CreateCategoryInput {
  code: string;
  name: string;
  /** Code of the parent category. Fixed once set. */
  parent?: string | null;
}

export class CategoryService {
  constructor(private repo: CatalogRepository) {}

  async create(i: CreateCategoryInput): Promise<Result<CategoryView, CatalogError>> {
    const problem =
      codeProblem("category code", i.code) ?? textProblem("category name", i.name, 120);
    if (problem) return violation(problem);

    let parent: ItemCategory | null = null;
    if (i.parent) {
      parent = await this.repo.getCategoryByCode(i.parent);
      if (!parent) return violation(`unknown parent category "${i.parent}"`);
    }
    const created = await attempt(() =>
      this.repo.insertCategory({
        id: newId(),
        parentId: parent?.id ?? null,
        code: i.code,
        name: i.name.trim(),
        ...newAudit(),
      }),
    );
    return created.ok ? ok({ ...created.value, parentCode: parent?.code ?? null }) : created;
  }

  async list(): Promise<CategoryView[]> {
    const all = await this.repo.listCategories();
    const codeById = new Map(all.map((c) => [c.id, c.code]));
    return all.map((c) => ({
      ...c,
      parentCode: c.parentId ? (codeById.get(c.parentId) ?? null) : null,
    }));
  }

  async rename(
    code: string,
    i: { version: number; name: string },
  ): Promise<Result<CategoryView, CatalogError>> {
    const current = await this.repo.getCategoryByCode(code);
    if (!current) return err(new NotFoundError("category"));
    const problem = textProblem("category name", i.name, 120);
    if (problem) return violation(problem);

    const updated = await attempt(() =>
      this.repo.updateCategory({ ...current, name: i.name.trim() }, i.version),
    );
    if (!updated.ok) return updated;
    const parent = updated.value.parentId
      ? await this.repo.getCategory(updated.value.parentId)
      : null;
    return ok({ ...updated.value, parentCode: parent?.code ?? null });
  }
}
