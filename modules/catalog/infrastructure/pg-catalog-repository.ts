import type { Pool, PoolClient } from "pg";
import type { CatalogRepository, ItemFilter, ItemPage } from "../application/ports.js";
import {
  CatalogError,
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../domain/errors.js";
import type {
  Audited,
  BarcodeType,
  Item,
  ItemBarcode,
  ItemCategory,
  ItemStatus,
  ItemUom,
  ResolvedBarcode,
  Uom,
} from "../domain/model.js";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/** Turns a database constraint failure into the module's own error. Always throws. */
function translate(e: unknown, duplicate: string, reference: string): never {
  const code = (e as { code?: string }).code;
  if (code === UNIQUE_VIOLATION) throw new ConflictError(duplicate);
  if (code === FOREIGN_KEY_VIOLATION) throw new RuleViolationError(reference);
  if (code === CHECK_VIOLATION) throw new RuleViolationError("a value is out of range");
  throw e;
}

interface AuditRow {
  created_at: Date;
  updated_at: Date;
  created_by: string | null;
  updated_by: string | null;
  version: number;
}

const audit = (r: AuditRow): Audited => ({
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  createdBy: r.created_by,
  updatedBy: r.updated_by,
  version: r.version,
});

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("expected the statement to return a row");
  return row;
}

const num = (v: string | null) => (v === null ? null : Number(v)); // numeric comes back as text

interface UomRow extends AuditRow {
  id: string;
  code: string;
  name: string;
}
const toUom = (r: UomRow): Uom => ({ id: r.id, code: r.code, name: r.name, ...audit(r) });

interface CategoryRow extends AuditRow {
  id: string;
  parent_id: string | null;
  code: string;
  name: string;
}
const toCategory = (r: CategoryRow): ItemCategory => ({
  id: r.id,
  parentId: r.parent_id,
  code: r.code,
  name: r.name,
  ...audit(r),
});

interface ItemRow extends AuditRow {
  id: string;
  sku: string;
  description: string;
  category_id: string | null;
  base_uom_id: string;
  base_uom_code: string;
  status: ItemStatus;
  is_lot_tracked: boolean;
  is_serial_tracked: boolean;
  has_expiry: boolean;
  shelf_life_days: number | null;
}
const toItem = (r: ItemRow): Item => ({
  id: r.id,
  sku: r.sku,
  description: r.description,
  categoryId: r.category_id,
  baseUom: { id: r.base_uom_id, code: r.base_uom_code },
  status: r.status,
  isLotTracked: r.is_lot_tracked,
  isSerialTracked: r.is_serial_tracked,
  hasExpiry: r.has_expiry,
  shelfLifeDays: r.shelf_life_days,
  ...audit(r),
});

interface ItemUomRow extends AuditRow {
  id: string;
  item_id: string;
  uom_id: string;
  uom_code: string;
  qty_in_base: number;
  length: string | null;
  width: string | null;
  height: string | null;
  weight: string | null;
}
const toItemUom = (r: ItemUomRow): ItemUom => ({
  id: r.id,
  itemId: r.item_id,
  uom: { id: r.uom_id, code: r.uom_code },
  qtyInBase: r.qty_in_base,
  length: num(r.length),
  width: num(r.width),
  height: num(r.height),
  weight: num(r.weight),
  ...audit(r),
});

interface BarcodeRow {
  id: string;
  item_id: string;
  item_uom_id: string;
  barcode: string;
  type: BarcodeType;
  created_at: Date;
  created_by: string | null;
}
const toBarcode = (r: BarcodeRow): ItemBarcode => ({
  id: r.id,
  itemId: r.item_id,
  itemUomId: r.item_uom_id,
  barcode: r.barcode,
  type: r.type,
  createdAt: r.created_at,
  createdBy: r.created_by,
});

const ITEM_SELECT = `
  SELECT i.*, u.code AS base_uom_code
    FROM catalog.item i
    JOIN catalog.uom u ON u.id = i.base_uom_id`;

const ITEM_UOM_SELECT = `
  SELECT iu.*, u.code AS uom_code
    FROM catalog.item_uom iu
    JOIN catalog.uom u ON u.id = iu.uom_id`;

export class PgCatalogRepository implements CatalogRepository {
  constructor(private pool: Pool) {}

  // ---- units of measure

  async listUoms(): Promise<Uom[]> {
    const { rows } = await this.pool.query<UomRow>(
      'SELECT * FROM catalog.uom ORDER BY code COLLATE "C"',
    );
    return rows.map(toUom);
  }

  async getUomByCode(code: string): Promise<Uom | null> {
    const { rows } = await this.pool.query<UomRow>(
      "SELECT * FROM catalog.uom WHERE lower(code) = lower($1)",
      [code],
    );
    return rows[0] ? toUom(rows[0]) : null;
  }

  async insertUom(u: Uom): Promise<Uom> {
    try {
      const { rows } = await this.pool.query<UomRow>(
        "INSERT INTO catalog.uom (id, code, name, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
        [u.id, u.code, u.name, u.createdBy],
      );
      return toUom(first(rows));
    } catch (e) {
      return translate(e, "a unit of measure with this code already exists", "invalid unit");
    }
  }

  // ---- categories

  async insertCategory(c: ItemCategory): Promise<ItemCategory> {
    try {
      const { rows } = await this.pool.query<CategoryRow>(
        `INSERT INTO catalog.item_category (id, parent_id, code, name, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [c.id, c.parentId, c.code, c.name, c.createdBy],
      );
      return toCategory(first(rows));
    } catch (e) {
      return translate(
        e,
        "a category with this code already exists",
        "the parent category does not exist",
      );
    }
  }

  async getCategory(id: string): Promise<ItemCategory | null> {
    const { rows } = await this.pool.query<CategoryRow>(
      "SELECT * FROM catalog.item_category WHERE id = $1",
      [id],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async getCategoryByCode(code: string): Promise<ItemCategory | null> {
    const { rows } = await this.pool.query<CategoryRow>(
      "SELECT * FROM catalog.item_category WHERE lower(code) = lower($1)",
      [code],
    );
    return rows[0] ? toCategory(rows[0]) : null;
  }

  async listCategories(): Promise<ItemCategory[]> {
    const { rows } = await this.pool.query<CategoryRow>(
      'SELECT * FROM catalog.item_category ORDER BY code COLLATE "C"',
    );
    return rows.map(toCategory);
  }

  async updateCategory(c: ItemCategory, expectedVersion: number): Promise<ItemCategory> {
    const { rows } = await this.pool.query<CategoryRow>(
      `UPDATE catalog.item_category
          SET name = $2, updated_by = $3, updated_at = now(), version = version + 1
        WHERE id = $1 AND version = $4
        RETURNING *`,
      [c.id, c.name, c.updatedBy, expectedVersion],
    );
    if (!rows[0])
      throw await this.staleOrMissing("catalog.item_category", c.id, "category", expectedVersion);
    return toCategory(rows[0]);
  }

  // ---- items

  async insertItem(item: Item, uoms: ItemUom[]): Promise<Item> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO catalog.item
           (id, sku, description, category_id, base_uom_id, status, is_lot_tracked,
            is_serial_tracked, has_expiry, shelf_life_days, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          item.id,
          item.sku,
          item.description,
          item.categoryId,
          item.baseUom.id,
          item.status,
          item.isLotTracked,
          item.isSerialTracked,
          item.hasExpiry,
          item.shelfLifeDays,
          item.createdBy,
        ],
      );
      for (const u of uoms) await this.insertItemUomWith(client, { ...u, itemId: item.id });
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      translate(
        e,
        "an item with this SKU already exists, or a unit is listed twice",
        "the base unit, category or a unit of measure does not exist",
      );
    } finally {
      client.release();
    }
    return this.mustGetItem(item.id);
  }

  async getItem(id: string): Promise<Item | null> {
    const { rows } = await this.pool.query<ItemRow>(`${ITEM_SELECT} WHERE i.id = $1`, [id]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  async getItemBySku(sku: string): Promise<Item | null> {
    const { rows } = await this.pool.query<ItemRow>(`${ITEM_SELECT} WHERE i.sku = $1`, [sku]);
    return rows[0] ? toItem(rows[0]) : null;
  }

  async listItems(filter: ItemFilter): Promise<ItemPage> {
    const { rows } = await this.pool.query<ItemRow>(
      `${ITEM_SELECT}
        WHERE ($1::text IS NULL OR i.status = $1)
          AND ($2::uuid IS NULL OR i.category_id = $2)
          AND ($3::text IS NULL OR i.sku COLLATE "C" > $3)
        ORDER BY i.sku COLLATE "C"
        LIMIT $4`,
      [filter.status ?? null, filter.categoryId ?? null, filter.after ?? null, filter.limit + 1],
    );
    const items = rows.slice(0, filter.limit).map(toItem);
    const last = items[items.length - 1];
    return { items, nextAfter: rows.length > filter.limit && last ? last.sku : null };
  }

  async updateItem(item: Item, expectedVersion: number): Promise<Item> {
    try {
      const upd = await this.pool.query(
        `UPDATE catalog.item
            SET description = $2, category_id = $3, status = $4, is_lot_tracked = $5,
                is_serial_tracked = $6, has_expiry = $7, shelf_life_days = $8,
                updated_by = $9, updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $10`,
        [
          item.id,
          item.description,
          item.categoryId,
          item.status,
          item.isLotTracked,
          item.isSerialTracked,
          item.hasExpiry,
          item.shelfLifeDays,
          item.updatedBy,
          expectedVersion,
        ],
      );
      if (upd.rowCount === 0) {
        throw await this.staleOrMissing("catalog.item", item.id, "item", expectedVersion);
      }
    } catch (e) {
      if (e instanceof CatalogError) throw e;
      translate(e, "conflicting item", "the category does not exist");
    }
    return this.mustGetItem(item.id);
  }

  // ---- item units

  async listItemUoms(itemId: string): Promise<ItemUom[]> {
    const { rows } = await this.pool.query<ItemUomRow>(
      `${ITEM_UOM_SELECT} WHERE iu.item_id = $1 ORDER BY u.code COLLATE "C"`,
      [itemId],
    );
    return rows.map(toItemUom);
  }

  async addItemUom(u: ItemUom): Promise<ItemUom> {
    try {
      await this.insertItemUomWith(this.pool, u);
    } catch (e) {
      translate(
        e,
        "this unit of measure is already defined for the item",
        "the item or unit of measure does not exist",
      );
    }
    return this.mustGetItemUom(u.id);
  }

  async updateItemUom(u: ItemUom, expectedVersion: number): Promise<ItemUom> {
    try {
      const upd = await this.pool.query(
        `UPDATE catalog.item_uom
            SET qty_in_base = $2, length = $3, width = $4, height = $5, weight = $6,
                updated_by = $7, updated_at = now(), version = version + 1
          WHERE id = $1 AND version = $8`,
        [u.id, u.qtyInBase, u.length, u.width, u.height, u.weight, u.updatedBy, expectedVersion],
      );
      if (upd.rowCount === 0) {
        throw await this.staleOrMissing("catalog.item_uom", u.id, "item unit", expectedVersion);
      }
    } catch (e) {
      if (e instanceof CatalogError) throw e;
      translate(e, "conflicting item unit", "invalid item unit");
    }
    return this.mustGetItemUom(u.id);
  }

  // ---- barcodes

  async addBarcode(b: ItemBarcode): Promise<ItemBarcode> {
    try {
      const { rows } = await this.pool.query<BarcodeRow>(
        `INSERT INTO catalog.item_barcode (id, item_id, item_uom_id, barcode, type, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [b.id, b.itemId, b.itemUomId, b.barcode, b.type, b.createdBy],
      );
      return toBarcode(first(rows));
    } catch (e) {
      return translate(
        e,
        "this barcode already exists",
        "the item, or its unit, does not exist for this item",
      );
    }
  }

  async listBarcodes(itemId: string): Promise<ItemBarcode[]> {
    const { rows } = await this.pool.query<BarcodeRow>(
      'SELECT * FROM catalog.item_barcode WHERE item_id = $1 ORDER BY barcode COLLATE "C"',
      [itemId],
    );
    return rows.map(toBarcode);
  }

  async deleteBarcode(id: string): Promise<void> {
    const res = await this.pool.query("DELETE FROM catalog.item_barcode WHERE id = $1", [id]);
    if (res.rowCount === 0) throw new NotFoundError("barcode");
  }

  async resolveBarcode(barcode: string): Promise<ResolvedBarcode | null> {
    const { rows } = await this.pool.query<BarcodeRow>(
      "SELECT * FROM catalog.item_barcode WHERE barcode = $1",
      [barcode],
    );
    const row = rows[0];
    if (!row) return null;
    const [item, itemUom] = await Promise.all([
      this.getItem(row.item_id),
      this.mustGetItemUom(row.item_uom_id),
    ]);
    return item ? { barcode: toBarcode(row), item, itemUom } : null;
  }

  // ---- helpers

  private insertItemUomWith(db: Pick<Pool | PoolClient, "query">, u: ItemUom) {
    return db.query(
      `INSERT INTO catalog.item_uom
         (id, item_id, uom_id, qty_in_base, length, width, height, weight, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [u.id, u.itemId, u.uom.id, u.qtyInBase, u.length, u.width, u.height, u.weight, u.createdBy],
    );
  }

  private async mustGetItem(id: string): Promise<Item> {
    const item = await this.getItem(id);
    if (!item) throw new Error("expected the item to exist");
    return item;
  }

  private async mustGetItemUom(id: string): Promise<ItemUom> {
    const { rows } = await this.pool.query<ItemUomRow>(`${ITEM_UOM_SELECT} WHERE iu.id = $1`, [id]);
    return toItemUom(first(rows));
  }

  /** An update matched no row: either it does not exist or someone else changed it first. */
  private async staleOrMissing(
    table: string,
    id: string,
    what: string,
    expectedVersion: number,
  ): Promise<CatalogError> {
    const { rows } = await this.pool.query<{ version: number }>(
      `SELECT version FROM ${table} WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return new NotFoundError(what);
    return new ConflictError(
      `the ${what} was changed by someone else (expected version ${expectedVersion}, found ${row.version})`,
    );
  }
}
