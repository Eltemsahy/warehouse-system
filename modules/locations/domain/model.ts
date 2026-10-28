// ADR 0004: business codes are exact-match text, 1 to 64 characters.
export const CODE_PATTERN = /^[A-Za-z0-9._/-]{1,64}$/;
export const CODE_MESSAGE = "must be 1 to 64 letters, digits, dot, underscore, slash or hyphen";
export const isValidCode = (code: string) => CODE_PATTERN.test(code);

export const WAREHOUSE_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type WarehouseStatus = (typeof WAREHOUSE_STATUSES)[number];

export const ZONE_TYPES = [
  "RECEIVING",
  "STORAGE",
  "PICKING",
  "PACKING",
  "SHIPPING",
  "QUARANTINE",
] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

/** AVAILABLE or BLOCKED is operational (a damaged rack); isActive is master-data retirement. */
export const LOCATION_STATUSES = ["AVAILABLE", "BLOCKED"] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

/** Audit columns shared by every mutable table (Schema doc, global conventions). */
export interface Audited {
  createdAt: Date;
  updatedAt: Date;
  /** User ids. Null until the identity module exists (P1-1, P1-2). */
  createdBy: string | null;
  updatedBy: string | null;
  /** Optimistic lock: starts at 1, +1 on every update. */
  version: number;
}

export interface Warehouse extends Audited {
  id: string;
  code: string;
  name: string;
  address: string | null;
  /** IANA time zone name, for example "Africa/Cairo". */
  timezone: string;
  status: WarehouseStatus;
}

export interface Zone extends Audited {
  id: string;
  warehouseId: string;
  code: string;
  type: ZoneType;
  isActive: boolean;
}

export interface LocationType extends Audited {
  id: string;
  code: string;
  name: string;
  isPickable: boolean;
  isStorable: boolean;
  isStaging: boolean;
}

export interface StorageClass extends Audited {
  id: string;
  code: string;
  name: string;
}

export interface LocationCapacity {
  maxUnits: number | null;
  maxWeight: number | null;
  maxVolume: number | null;
  maxLpns: number | null;
}

export type LocationTypeRef = Pick<
  LocationType,
  "id" | "code" | "isPickable" | "isStorable" | "isStaging"
>;
export type StorageClassRef = Pick<StorageClass, "id" | "code">;

export interface Location extends Audited {
  id: string;
  warehouseId: string;
  zoneId: string | null;
  type: LocationTypeRef;
  /** Unique within the warehouse, immutable (ADR 0004). */
  code: string;
  aisle: string | null;
  bay: string | null;
  level: string | null;
  position: string | null;
  status: LocationStatus;
  isActive: boolean;
  capacity: LocationCapacity | null;
  /** Sorted by code. */
  storageClasses: StorageClassRef[];
}

/** Reference data that migration 006 seeds; the in-memory repository seeds the same. */
export const DEFAULT_LOCATION_TYPES = [
  { code: "BIN", name: "Shelf or rack bin", isPickable: true, isStorable: true, isStaging: false },
  {
    code: "PALLET",
    name: "Pallet position",
    isPickable: false,
    isStorable: true,
    isStaging: false,
  },
  {
    code: "FLOOR",
    name: "Bulk floor storage",
    isPickable: false,
    isStorable: true,
    isStaging: false,
  },
  { code: "STAGING", name: "Staging area", isPickable: false, isStorable: false, isStaging: true },
] as const;

export const DEFAULT_STORAGE_CLASSES = [
  { code: "AMBIENT", name: "Ambient" },
  { code: "COLD", name: "Cold" },
  { code: "FROZEN", name: "Frozen" },
  { code: "HAZMAT", name: "Hazardous materials" },
] as const;
