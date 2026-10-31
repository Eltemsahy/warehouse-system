import type { Item, ItemCategory, ItemStatus, ItemUom, Uom } from "../domain/model.js";

export interface ItemFilter {
  status?: ItemStatus;
  categoryId?: string;
  /** Keyset pagination: only items whose SKU sorts after this one. */
  after?: string;
  limit: number;
}

export interface ItemPage {
  items: Item[];
  /** Pass as `after` to get the next page; null on the last page. */
  nextAfter: string | null;
}

/**
 * Persistence for the catalog module. Every adapter must pass
 * tests/contract/catalog-repository.contract.ts. Errors every adapter throws:
 * - the insert and add methods: ConflictError for a duplicate code or SKU (compared case-insensitively) or a
 *   unit already defined for the item; RuleViolationError when something referenced is
 *   missing (parent category, base unit, item, unit of measure).
 * - the update methods: NotFoundError when the row is missing, ConflictError when `expectedVersion` is
 *   stale. Updates never change a code, a SKU, a base unit, or what an item unit belongs to.
 */
export interface CatalogRepository {
  listUoms(): Promise<Uom[]>;
  /** Case-insensitive. */
  getUomByCode(code: string): Promise<Uom | null>;
  insertUom(u: Uom): Promise<Uom>;

  insertCategory(c: ItemCategory): Promise<ItemCategory>;
  getCategory(id: string): Promise<ItemCategory | null>;
  /** Case-insensitive. */
  getCategoryByCode(code: string): Promise<ItemCategory | null>;
  listCategories(): Promise<ItemCategory[]>;
  /** Only the name can change. */
  updateCategory(c: ItemCategory, expectedVersion: number): Promise<ItemCategory>;

  /** Stores the item and its units in one step (the caller includes the base unit). */
  insertItem(item: Item, uoms: ItemUom[]): Promise<Item>;
  getItem(id: string): Promise<Item | null>;
  /** Exact, case-sensitive match on the SKU (ADR 0004). */
  getItemBySku(sku: string): Promise<Item | null>;
  listItems(filter: ItemFilter): Promise<ItemPage>;
  updateItem(item: Item, expectedVersion: number): Promise<Item>;

  /** Ordered by unit code. */
  listItemUoms(itemId: string): Promise<ItemUom[]>;
  addItemUom(u: ItemUom): Promise<ItemUom>;
  updateItemUom(u: ItemUom, expectedVersion: number): Promise<ItemUom>;
}
