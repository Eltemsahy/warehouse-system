import type { CatalogRepository } from "./ports.js";

/** What other modules may know about an item. */
export interface CatalogItemView {
  id: string;
  sku: string;
  description: string;
  /** Code of the base unit of measure: stock is counted in whole numbers of it. */
  baseUom: string;
  isActive: boolean;
  isLotTracked: boolean;
  isSerialTracked: boolean;
  hasExpiry: boolean;
  shelfLifeDays: number | null;
}

/** What other modules may know about a scanned barcode. */
export interface ScannedBarcodeView {
  barcode: string;
  /** The unit the barcode identifies, and how many base units one scan stands for. */
  uom: string;
  qtyInBase: number;
  item: CatalogItemView;
}

/** The module's public, read-only queries (Implementation Plan P1-4, used by P1-5). */
export class CatalogQueries {
  constructor(private repo: CatalogRepository) {}

  /** Exact, case-sensitive SKU match (ADR 0004). */
  async getItem(sku: string): Promise<CatalogItemView | null> {
    const item = await this.repo.getItemBySku(sku);
    return item ? toView(item) : null;
  }

  /** True when the SKU exists and the item is active. */
  async exists(sku: string): Promise<boolean> {
    return (await this.repo.getItemBySku(sku))?.status === "ACTIVE";
  }

  async resolveBarcode(barcode: string): Promise<ScannedBarcodeView | null> {
    const found = await this.repo.resolveBarcode(barcode);
    return found
      ? {
          barcode: found.barcode.barcode,
          uom: found.itemUom.uom.code,
          qtyInBase: found.itemUom.qtyInBase,
          item: toView(found.item),
        }
      : null;
  }
}

function toView(
  item: Awaited<ReturnType<CatalogRepository["getItemBySku"]>> & object,
): CatalogItemView {
  return {
    id: item.id,
    sku: item.sku,
    description: item.description,
    baseUom: item.baseUom.code,
    isActive: item.status === "ACTIVE",
    isLotTracked: item.isLotTracked,
    isSerialTracked: item.isSerialTracked,
    hasExpiry: item.hasExpiry,
    shelfLifeDays: item.shelfLifeDays,
  };
}
