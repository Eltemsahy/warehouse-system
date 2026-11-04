// ADR 0004: business codes (SKUs included) are exact-match text, 1 to 64 characters.
export const CODE_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/;
export const CODE_MESSAGE = "must be 1 to 64 letters, digits, dot, underscore, slash or hyphen";
export const isValidCode = (code: string) => CODE_PATTERN.test(code);

export const ITEM_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Audit columns shared by every mutable table (Schema doc, global conventions). */
export interface Audited {
  createdAt: Date;
  updatedAt: Date;
  /** User ids. Null until the identity module exists. */
  createdBy: string | null;
  updatedBy: string | null;
  /** Optimistic lock: starts at 1, +1 on every update. */
  version: number;
}

export interface Uom extends Audited {
  id: string;
  code: string;
  name: string;
}
export type UomRef = Pick<Uom, "id" | "code">;

/** A tree: a category's parent is fixed when it is created, so cycles cannot form. */
export interface ItemCategory extends Audited {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
}

export interface Item extends Audited {
  id: string;
  /** Organisation-wide, immutable (ADR 0004). */
  sku: string;
  description: string;
  categoryId: string | null;
  /** Stock is counted in whole numbers of this unit. Immutable. */
  baseUom: UomRef;
  status: ItemStatus;
  isLotTracked: boolean;
  isSerialTracked: boolean;
  hasExpiry: boolean;
  shelfLifeDays: number | null;
}

/** How an item is packed in one unit of measure. The base unit has qtyInBase 1. */
export interface ItemUom extends Audited {
  id: string;
  itemId: string;
  uom: UomRef;
  /** Whole number of base units in one of these. */
  qtyInBase: number;
  length: number | null;
  width: number | null;
  height: number | null;
  weight: number | null;
}

// Printable ASCII without spaces, 1 to 128 characters: what scanners send.
export const BARCODE_PATTERN = /^[!-~]{1,128}$/;
export const BARCODE_MESSAGE = "must be 1 to 128 printable characters, without spaces";
export const BARCODE_TYPES = ["EAN13", "EAN8", "UPC_A", "ITF14", "CODE128", "OTHER"] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/** Identifies an item in one of its units. Immutable: remove it and add another instead. */
export interface ItemBarcode {
  id: string;
  itemId: string;
  itemUomId: string;
  /** Organisation-wide, matched exactly (case-sensitive). */
  barcode: string;
  type: BarcodeType;
  createdAt: Date;
  createdBy: string | null;
}

/** What scanning a barcode tells you. */
export interface ResolvedBarcode {
  barcode: ItemBarcode;
  item: Item;
  itemUom: ItemUom;
}

/** Reference data that migration 007 seeds; the in-memory repository seeds the same. */
export const DEFAULT_UOMS = [
  { code: "EA", name: "Each" },
  { code: "CS", name: "Case" },
  { code: "PL", name: "Pallet" },
] as const;
