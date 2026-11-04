import { newId } from "../../../shared/kernel/index.js";
import type { CatalogRepository, ItemFilter, ItemPage } from "../application/ports.js";
import { ConflictError, NotFoundError, RuleViolationError } from "../domain/errors.js";
import {
  DEFAULT_UOMS,
  type Item,
  type ItemBarcode,
  type ItemCategory,
  type ItemUom,
  type ResolvedBarcode,
  type Uom,
} from "../domain/model.js";

const lower = (s: string) => s.toLowerCase();
const byKey =
  <T>(key: (x: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
const copy = <T>(value: T): T => structuredClone(value);

/** For tests and local development. Honours the same contract as PgCatalogRepository. */
export class InMemoryCatalogRepository implements CatalogRepository {
  private uoms = new Map<string, Uom>();
  private categories = new Map<string, ItemCategory>();
  private items = new Map<string, Item>();
  private itemUoms = new Map<string, ItemUom>();
  private barcodes = new Map<string, ItemBarcode>();

  /** `seed` loads the same units of measure that migration 007 inserts. */
  constructor(seed = true) {
    if (!seed) return;
    const now = new Date();
    for (const u of DEFAULT_UOMS) {
      const id = newId();
      this.uoms.set(id, {
        id,
        ...u,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        version: 1,
      });
    }
  }

  // ---- units of measure

  async listUoms() {
    return [...this.uoms.values()].sort(byKey((u) => u.code)).map(copy);
  }

  async getUomByCode(code: string) {
    for (const u of this.uoms.values()) if (lower(u.code) === lower(code)) return copy(u);
    return null;
  }

  async insertUom(u: Uom) {
    if ([...this.uoms.values()].some((x) => lower(x.code) === lower(u.code))) {
      throw new ConflictError("a unit of measure with this code already exists");
    }
    return this.store(this.uoms, { ...copy(u), ...this.fresh() });
  }

  // ---- categories

  async insertCategory(c: ItemCategory) {
    if (c.parentId !== null && !this.categories.has(c.parentId)) {
      throw new RuleViolationError("the parent category does not exist");
    }
    if ([...this.categories.values()].some((x) => lower(x.code) === lower(c.code))) {
      throw new ConflictError("a category with this code already exists");
    }
    return this.store(this.categories, { ...copy(c), ...this.fresh() });
  }

  async getCategory(id: string) {
    const c = this.categories.get(id);
    return c ? copy(c) : null;
  }

  async getCategoryByCode(code: string) {
    for (const c of this.categories.values()) if (lower(c.code) === lower(code)) return copy(c);
    return null;
  }

  async listCategories() {
    return [...this.categories.values()].sort(byKey((c) => c.code)).map(copy);
  }

  async updateCategory(c: ItemCategory, expectedVersion: number) {
    const current = this.requireVersion(this.categories, c.id, "category", expectedVersion);
    return this.store(this.categories, {
      ...current,
      name: c.name,
      ...this.touched(c.updatedBy, current.version),
    });
  }

  // ---- items

  async insertItem(item: Item, uoms: ItemUom[]) {
    this.checkItemReferences(item);
    if ([...this.items.values()].some((x) => lower(x.sku) === lower(item.sku))) {
      throw new ConflictError("an item with this SKU already exists");
    }
    // Validate every unit before storing anything, so a failure leaves no trace.
    const seen = new Set<string>();
    for (const u of uoms) {
      if (!this.uoms.has(u.uom.id))
        throw new RuleViolationError("a unit of measure does not exist");
      if (seen.has(u.uom.id)) throw new ConflictError("a unit of measure is listed twice");
      seen.add(u.uom.id);
    }
    const stored = this.store(this.items, { ...copy(item), ...this.fresh() });
    for (const u of uoms) {
      this.store(this.itemUoms, { ...copy(u), itemId: item.id, ...this.fresh() });
    }
    return stored;
  }

  async getItem(id: string) {
    const i = this.items.get(id);
    return i ? copy(i) : null;
  }

  async getItemBySku(sku: string) {
    for (const i of this.items.values()) if (i.sku === sku) return copy(i);
    return null;
  }

  async listItems(filter: ItemFilter): Promise<ItemPage> {
    const rows = [...this.items.values()]
      .filter((i) => filter.status === undefined || i.status === filter.status)
      .filter((i) => filter.categoryId === undefined || i.categoryId === filter.categoryId)
      .filter((i) => filter.after === undefined || i.sku > filter.after)
      .sort(byKey((i) => i.sku));
    const items = rows.slice(0, filter.limit).map(copy);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.sku : null };
  }

  async updateItem(item: Item, expectedVersion: number) {
    const current = this.requireVersion(this.items, item.id, "item", expectedVersion);
    this.checkItemReferences({ ...item, baseUom: current.baseUom });
    return this.store(this.items, {
      ...current,
      description: item.description,
      categoryId: item.categoryId,
      status: item.status,
      isLotTracked: item.isLotTracked,
      isSerialTracked: item.isSerialTracked,
      hasExpiry: item.hasExpiry,
      shelfLifeDays: item.shelfLifeDays,
      ...this.touched(item.updatedBy, current.version),
    });
  }

  // ---- item units

  async listItemUoms(itemId: string) {
    return [...this.itemUoms.values()]
      .filter((u) => u.itemId === itemId)
      .sort(byKey((u) => u.uom.code))
      .map(copy);
  }

  async addItemUom(u: ItemUom) {
    if (!this.items.has(u.itemId)) throw new RuleViolationError("the item does not exist");
    if (!this.uoms.has(u.uom.id))
      throw new RuleViolationError("the unit of measure does not exist");
    if ([...this.itemUoms.values()].some((x) => x.itemId === u.itemId && x.uom.id === u.uom.id)) {
      throw new ConflictError("this unit of measure is already defined for the item");
    }
    return this.store(this.itemUoms, { ...copy(u), ...this.fresh() });
  }

  async updateItemUom(u: ItemUom, expectedVersion: number) {
    const current = this.requireVersion(this.itemUoms, u.id, "item unit", expectedVersion);
    return this.store(this.itemUoms, {
      ...current,
      qtyInBase: u.qtyInBase,
      length: u.length,
      width: u.width,
      height: u.height,
      weight: u.weight,
      ...this.touched(u.updatedBy, current.version),
    });
  }

  // ---- barcodes

  async addBarcode(b: ItemBarcode) {
    const unit = this.itemUoms.get(b.itemUomId);
    if (!this.items.has(b.itemId)) throw new RuleViolationError("the item does not exist");
    if (!unit || unit.itemId !== b.itemId) {
      throw new RuleViolationError("the item unit does not exist for this item");
    }
    if ([...this.barcodes.values()].some((x) => x.barcode === b.barcode)) {
      throw new ConflictError("this barcode already exists");
    }
    return this.store(this.barcodes, { ...copy(b), createdAt: new Date() });
  }

  async listBarcodes(itemId: string) {
    return [...this.barcodes.values()]
      .filter((b) => b.itemId === itemId)
      .sort(byKey((b) => b.barcode))
      .map(copy);
  }

  async deleteBarcode(id: string) {
    if (!this.barcodes.delete(id)) throw new NotFoundError("barcode");
  }

  async resolveBarcode(barcode: string): Promise<ResolvedBarcode | null> {
    for (const b of this.barcodes.values()) {
      if (b.barcode !== barcode) continue;
      const item = this.items.get(b.itemId);
      const itemUom = this.itemUoms.get(b.itemUomId);
      if (!item || !itemUom) return null;
      return { barcode: copy(b), item: copy(item), itemUom: copy(itemUom) };
    }
    return null;
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

  private checkItemReferences(item: Item) {
    if (!this.uoms.has(item.baseUom.id)) {
      throw new RuleViolationError("the base unit of measure does not exist");
    }
    if (item.categoryId !== null && !this.categories.has(item.categoryId)) {
      throw new RuleViolationError("the category does not exist");
    }
  }
}
