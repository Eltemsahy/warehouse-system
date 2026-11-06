import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type CatalogError } from "../domain/errors.js";
import type { Item, ItemStatus, ItemUom, Uom } from "../domain/model.js";
import { ITEM_STATUSES } from "../domain/model.js";
import type { CatalogRepository } from "./ports.js";
import {
  attempt,
  codeProblem,
  measureProblem,
  newAudit,
  quantityProblem,
  textProblem,
  violation,
} from "./support.js";

type Measure = number | null | undefined;

export type ItemView = Item & { categoryCode: string | null };
export interface ItemDetail {
  item: ItemView;
  units: ItemUom[];
}

export interface UnitInput {
  /** Unit of measure code, for example "CS". */
  uom: string;
  /** Whole base units in one of these. Optional only for the base unit, which is always 1. */
  qtyInBase?: number;
  length?: Measure;
  width?: Measure;
  height?: Measure;
  weight?: Measure;
}

export interface CreateItemInput {
  sku: string;
  description: string;
  /** Base unit of measure code. Stock is counted in whole numbers of it, forever. */
  baseUom: string;
  category?: string | null;
  isLotTracked?: boolean;
  isSerialTracked?: boolean;
  hasExpiry?: boolean;
  shelfLifeDays?: number | null;
  /** Extra units. The base unit (quantity 1) is created automatically. */
  units?: UnitInput[];
}

/**
 * The tracking flags (lot, serial, expiry) are not here on purpose: changing them once stock
 * exists would change what that stock means, and the catalog cannot ask inventory yet.
 */
export interface UpdateItemInput {
  version: number;
  description?: string;
  category?: string | null;
  status?: ItemStatus;
  shelfLifeDays?: number | null;
}

export interface UpdateUnitInput {
  version: number;
  qtyInBase?: number;
  length?: Measure;
  width?: Measure;
  height?: Measure;
  weight?: Measure;
}

export interface ListItemsInput {
  status?: ItemStatus;
  /** Category code. */
  category?: string;
  after?: string;
  limit: number;
}

export class ItemService {
  constructor(private repo: CatalogRepository) {}

  async create(i: CreateItemInput): Promise<Result<ItemDetail, CatalogError>> {
    const hasExpiry = i.hasExpiry ?? false;
    const problem =
      codeProblem("SKU", i.sku) ??
      textProblem("description", i.description, 500) ??
      this.shelfLifeProblem(i.shelfLifeDays, hasExpiry);
    if (problem) return violation(problem);

    const base = await this.repo.getUomByCode(i.baseUom);
    if (!base) return violation(`unknown unit of measure "${i.baseUom}"`);

    let categoryId: string | null = null;
    if (i.category) {
      const category = await this.repo.getCategoryByCode(i.category);
      if (!category) return violation(`unknown category "${i.category}"`);
      categoryId = category.id;
    }

    // Resolve every listed unit; the base unit may appear only to carry its dimensions.
    const units = new Map<string, ItemUom>();
    const itemId = newId();
    for (const u of i.units ?? []) {
      const uom = await this.repo.getUomByCode(u.uom);
      if (!uom) return violation(`unknown unit of measure "${u.uom}"`);
      if (units.has(uom.id)) return violation(`unit "${uom.code}" is listed twice`);
      const isBase = uom.id === base.id;
      if (u.qtyInBase === undefined && !isBase)
        return violation(`unit "${uom.code}" needs qtyInBase`);
      const qty = u.qtyInBase ?? 1;
      const unitProblem =
        this.unitProblem(qty, u) ??
        (isBase && qty !== 1 ? "the base unit always holds 1" : undefined);
      if (unitProblem) return violation(unitProblem);
      units.set(uom.id, this.newUnit(itemId, uom, qty, u));
    }
    if (!units.has(base.id)) units.set(base.id, this.newUnit(itemId, base, 1, {}));

    const created = await attempt(() =>
      this.repo.insertItem(
        {
          id: itemId,
          sku: i.sku,
          description: i.description.trim(),
          categoryId,
          baseUom: { id: base.id, code: base.code },
          status: "ACTIVE",
          isLotTracked: i.isLotTracked ?? false,
          isSerialTracked: i.isSerialTracked ?? false,
          hasExpiry,
          shelfLifeDays: i.shelfLifeDays ?? null,
          ...newAudit(),
        },
        [...units.values()],
      ),
    );
    return created.ok ? ok(await this.detail(created.value)) : created;
  }

  async get(sku: string): Promise<Result<ItemDetail, CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    return item ? ok(await this.detail(item)) : err(new NotFoundError("item"));
  }

  async list(
    i: ListItemsInput,
  ): Promise<Result<{ items: ItemView[]; nextAfter: string | null }, CatalogError>> {
    let categoryId: string | undefined;
    if (i.category !== undefined) {
      const category = await this.repo.getCategoryByCode(i.category);
      if (!category) return violation(`unknown category "${i.category}"`);
      categoryId = category.id;
    }
    const page = await this.repo.listItems({
      status: i.status,
      categoryId,
      after: i.after,
      limit: i.limit,
    });
    const codes = await this.categoryCodes();
    return ok({
      items: page.items.map((item) => ({
        ...item,
        categoryCode: codes.get(item.categoryId ?? "") ?? null,
      })),
      nextAfter: page.nextAfter,
    });
  }

  async update(sku: string, i: UpdateItemInput): Promise<Result<ItemDetail, CatalogError>> {
    const current = await this.repo.getItemBySku(sku);
    if (!current) return err(new NotFoundError("item"));

    const problem =
      (i.description === undefined ? undefined : textProblem("description", i.description, 500)) ??
      (i.status === undefined || ITEM_STATUSES.includes(i.status)
        ? undefined
        : `unknown status "${i.status}"`) ??
      (i.shelfLifeDays === undefined
        ? undefined
        : this.shelfLifeProblem(i.shelfLifeDays, current.hasExpiry));
    if (problem) return violation(problem);

    let categoryId = current.categoryId;
    if (i.category !== undefined) {
      if (i.category === null) {
        categoryId = null;
      } else {
        const category = await this.repo.getCategoryByCode(i.category);
        if (!category) return violation(`unknown category "${i.category}"`);
        categoryId = category.id;
      }
    }

    const updated = await attempt(() =>
      this.repo.updateItem(
        {
          ...current,
          description: i.description?.trim() ?? current.description,
          categoryId,
          status: i.status ?? current.status,
          shelfLifeDays: i.shelfLifeDays === undefined ? current.shelfLifeDays : i.shelfLifeDays,
        },
        i.version,
      ),
    );
    return updated.ok ? ok(await this.detail(updated.value)) : updated;
  }

  async listUnits(sku: string): Promise<Result<ItemUom[], CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    return item ? ok(await this.repo.listItemUoms(item.id)) : err(new NotFoundError("item"));
  }

  async addUnit(
    sku: string,
    i: UnitInput & { qtyInBase: number },
  ): Promise<Result<ItemUom, CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    if (!item) return err(new NotFoundError("item"));
    const uom = await this.repo.getUomByCode(i.uom);
    if (!uom) return violation(`unknown unit of measure "${i.uom}"`);
    const problem = this.unitProblem(i.qtyInBase, i);
    if (problem) return violation(problem);
    return attempt(() => this.repo.addItemUom(this.newUnit(item.id, uom, i.qtyInBase, i)));
  }

  async updateUnit(
    sku: string,
    uomCode: string,
    i: UpdateUnitInput,
  ): Promise<Result<ItemUom, CatalogError>> {
    const item = await this.repo.getItemBySku(sku);
    if (!item) return err(new NotFoundError("item"));
    const units = await this.repo.listItemUoms(item.id);
    const current = units.find((u) => u.uom.code.toLowerCase() === uomCode.toLowerCase());
    if (!current) return err(new NotFoundError("item unit"));

    const qty = i.qtyInBase ?? current.qtyInBase;
    const isBase = current.uom.id === item.baseUom.id;
    const problem =
      this.unitProblem(qty, { ...current, ...definedOnly(i) }) ??
      (isBase && qty !== 1 ? "the base unit always holds 1" : undefined);
    if (problem) return violation(problem);

    return attempt(() =>
      this.repo.updateItemUom(
        {
          ...current,
          qtyInBase: qty,
          length: i.length === undefined ? current.length : i.length,
          width: i.width === undefined ? current.width : i.width,
          height: i.height === undefined ? current.height : i.height,
          weight: i.weight === undefined ? current.weight : i.weight,
        },
        i.version,
      ),
    );
  }

  // ---- helpers

  private shelfLifeProblem(days: number | null | undefined, hasExpiry: boolean) {
    if (days === null || days === undefined) return undefined;
    if (!hasExpiry) return "shelfLifeDays only applies to an item that expires";
    return Number.isInteger(days) && days >= 1
      ? undefined
      : "shelfLifeDays must be a whole number of 1 or more";
  }

  private unitProblem(
    qty: number,
    m: { length?: Measure; width?: Measure; height?: Measure; weight?: Measure },
  ) {
    return (
      quantityProblem(qty) ??
      measureProblem("length", m.length) ??
      measureProblem("width", m.width) ??
      measureProblem("height", m.height) ??
      measureProblem("weight", m.weight)
    );
  }

  private newUnit(
    itemId: string,
    uom: Uom,
    qtyInBase: number,
    m: UnitInput | Record<string, never>,
  ): ItemUom {
    const d = m as Partial<UnitInput>;
    return {
      id: newId(),
      itemId,
      uom: { id: uom.id, code: uom.code },
      qtyInBase,
      length: d.length ?? null,
      width: d.width ?? null,
      height: d.height ?? null,
      weight: d.weight ?? null,
      ...newAudit(),
    };
  }

  private async categoryCodes() {
    return new Map((await this.repo.listCategories()).map((c) => [c.id, c.code]));
  }

  private async detail(item: Item): Promise<ItemDetail> {
    const category = item.categoryId ? await this.repo.getCategory(item.categoryId) : null;
    const units = await this.repo.listItemUoms(item.id);
    return { item: { ...item, categoryCode: category?.code ?? null }, units };
  }
}

/** The properties that were actually provided (undefined means "leave unchanged"). */
function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}
