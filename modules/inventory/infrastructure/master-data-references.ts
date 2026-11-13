import type { StockReferences } from "../application/ports.js";

/** The part of the locations module this check needs (structurally, so no module import). */
export interface LocationDirectory {
  getWarehouse(warehouseId: string): Promise<{ isActive: boolean } | null>;
  /** Exact, case-sensitive code match within the warehouse (ADR 0004). */
  getLocation(warehouseId: string, code: string): Promise<{ isActive: boolean } | null>;
}

/** The part of the catalog module this check needs. */
export interface ItemDirectory {
  /** Exact, case-sensitive SKU match (ADR 0004). */
  getItem(sku: string): Promise<{ isActive: boolean } | null>;
}

/**
 * Checks stock postings against the master data (Implementation Plan P1-5).
 *
 * Adding stock needs an active warehouse, an active location in it, and an active SKU.
 * Removing stock only needs them to exist: a retired location or SKU may still hold stock,
 * and that stock must be able to leave.
 */
export class MasterDataReferences implements StockReferences {
  constructor(
    private locations: LocationDirectory,
    private items: ItemDirectory,
  ) {}

  async problem(
    warehouseId: string,
    sku: string,
    locationId: string,
    direction: "IN" | "OUT",
  ): Promise<string | undefined> {
    const [warehouse, location, item] = await Promise.all([
      this.locations.getWarehouse(warehouseId),
      this.locations.getLocation(warehouseId, locationId),
      this.items.getItem(sku),
    ]);

    if (!warehouse) return "unknown warehouse";
    if (!location) return `unknown location "${locationId}" in this warehouse`;
    if (!item) return `unknown SKU "${sku}"`;

    if (direction === "IN") {
      if (!warehouse.isActive) return "the warehouse is inactive: stock cannot be added";
      if (!location.isActive) return `location "${locationId}" is inactive: stock cannot be added`;
      if (!item.isActive) return `SKU "${sku}" is inactive: stock cannot be added`;
    }
    return undefined;
  }
}
