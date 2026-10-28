import { Router, type Response } from "express";
import { z } from "zod";
import type { Result } from "../../../shared/kernel/index.js";
import type { LocationService } from "../application/location-service.js";
import type { ReferenceDataService } from "../application/reference-data-service.js";
import type { WarehouseService } from "../application/warehouse-service.js";
import type { ZoneService } from "../application/zone-service.js";
import { ConflictError, NotFoundError, type LocationsError } from "../domain/errors.js";
import {
  CODE_MESSAGE,
  CODE_PATTERN,
  LOCATION_STATUSES,
  WAREHOUSE_STATUSES,
  ZONE_TYPES,
  type Location,
  type LocationType,
  type StorageClass,
  type Warehouse,
  type Zone,
} from "../domain/model.js";

const code = z.string().regex(CODE_PATTERN, CODE_MESSAGE);
const uuid = z.string().uuid();
const version = z.number().int().min(1);
const shortText = z.string().min(1).max(32).nullable().optional();
const hasChanges = (body: Record<string, unknown>) =>
  Object.keys(body).some((key) => key !== "version");

const capacity = z
  .object({
    maxUnits: z.number().int().min(0).nullable().optional(),
    maxWeight: z.number().min(0).nullable().optional(),
    maxVolume: z.number().min(0).nullable().optional(),
    maxLpns: z.number().int().min(0).nullable().optional(),
  })
  .strict();

const warehouseParams = z.object({ warehouseId: uuid });
const zoneParams = z.object({ warehouseId: uuid, zoneId: uuid });
const locationParams = z.object({ warehouseId: uuid, code });

const createWarehouse = z
  .object({
    code,
    name: z.string().min(1).max(120),
    address: z.string().max(500).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
  })
  .strict();
const updateWarehouse = z
  .object({
    version,
    name: z.string().min(1).max(120).optional(),
    address: z.string().max(500).nullable().optional(),
    timezone: z.string().min(1).max(64).optional(),
    status: z.enum(WAREHOUSE_STATUSES).optional(),
  })
  .strict()
  .refine(hasChanges, "nothing to update");

const createZone = z.object({ code, type: z.enum(ZONE_TYPES) }).strict();
const updateZone = z
  .object({ version, type: z.enum(ZONE_TYPES).optional(), isActive: z.boolean().optional() })
  .strict()
  .refine(hasChanges, "nothing to update");

const createLocation = z
  .object({
    code,
    zoneId: uuid.nullable().optional(),
    type: code,
    aisle: shortText,
    bay: shortText,
    level: shortText,
    position: shortText,
    capacity: capacity.nullable().optional(),
    storageClasses: z.array(code).max(20).optional(),
  })
  .strict();
const updateLocation = z
  .object({
    version,
    zoneId: uuid.nullable().optional(),
    type: code.optional(),
    aisle: shortText,
    bay: shortText,
    level: shortText,
    position: shortText,
    status: z.enum(LOCATION_STATUSES).optional(),
    isActive: z.boolean().optional(),
    capacity: capacity.nullable().optional(),
    storageClasses: z.array(code).max(20).optional(),
  })
  .strict()
  .refine(hasChanges, "nothing to update");

const listLocationsQuery = z
  .object({
    zoneId: uuid.optional(),
    type: code.optional(),
    status: z.enum(LOCATION_STATUSES).optional(),
    active: z.enum(["true", "false"]).optional(),
    after: code.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const createLocationType = z
  .object({
    code,
    name: z.string().min(1).max(120),
    isPickable: z.boolean().optional(),
    isStorable: z.boolean().optional(),
    isStaging: z.boolean().optional(),
  })
  .strict();
const createStorageClass = z.object({ code, name: z.string().min(1).max(120) }).strict();

const presentWarehouse = (w: Warehouse) => ({
  id: w.id,
  code: w.code,
  name: w.name,
  address: w.address,
  timezone: w.timezone,
  status: w.status,
  createdAt: w.createdAt,
  updatedAt: w.updatedAt,
  version: w.version,
});

const presentZone = (z: Zone) => ({
  id: z.id,
  warehouseId: z.warehouseId,
  code: z.code,
  type: z.type,
  isActive: z.isActive,
  createdAt: z.createdAt,
  updatedAt: z.updatedAt,
  version: z.version,
});

const presentLocation = (l: Location) => ({
  id: l.id,
  warehouseId: l.warehouseId,
  zoneId: l.zoneId,
  code: l.code,
  type: l.type.code,
  isPickable: l.type.isPickable,
  isStorable: l.type.isStorable,
  isStaging: l.type.isStaging,
  aisle: l.aisle,
  bay: l.bay,
  level: l.level,
  position: l.position,
  status: l.status,
  isActive: l.isActive,
  capacity: l.capacity,
  storageClasses: l.storageClasses.map((c) => c.code),
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
  version: l.version,
});

const presentType = (t: LocationType) => ({
  code: t.code,
  name: t.name,
  isPickable: t.isPickable,
  isStorable: t.isStorable,
  isStaging: t.isStaging,
});

const presentClass = (c: StorageClass) => ({ code: c.code, name: c.name });

function statusOf(error: LocationsError): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422;
}

function send<T>(
  res: Response,
  result: Result<T, LocationsError>,
  status: number,
  present: (value: T) => unknown,
): Response {
  if (result.ok) return res.status(status).json(present(result.value));
  return res.status(statusOf(result.error)).json({ error: result.error.message });
}

export interface LocationsRouteDeps {
  warehouses: WarehouseService;
  zones: ZoneService;
  locations: LocationService;
  referenceData: ReferenceDataService;
}

/**
 * Mounted at /locations. Warehouse-scoped resources live under /warehouses/:warehouseId, so a
 * future middleware can authorise them in one place (ADR 0004). A body or query that does not
 * validate answers 400; a missing resource 404; a duplicate code or a stale version 409; a
 * rule broken by otherwise valid input 422.
 */
export function locationsRoutes(deps: LocationsRouteDeps) {
  const r = Router();

  // ---- warehouses

  r.post("/warehouses", async (req, res) => {
    const body = createWarehouse.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.warehouses.create(body.data), 201, presentWarehouse);
  });

  r.get("/warehouses", async (_req, res) => {
    const items = await deps.warehouses.list();
    return res.json({ items: items.map(presentWarehouse) });
  });

  r.get("/warehouses/:warehouseId", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.warehouses.get(params.data.warehouseId), 200, presentWarehouse);
  });

  r.patch("/warehouses/:warehouseId", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = updateWarehouse.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.warehouses.update(params.data.warehouseId, body.data),
      200,
      presentWarehouse,
    );
  });

  // ---- zones

  r.post("/warehouses/:warehouseId/zones", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = createZone.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.zones.create(params.data.warehouseId, body.data), 201, presentZone);
  });

  r.get("/warehouses/:warehouseId/zones", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.zones.list(params.data.warehouseId), 200, (zones) => ({
      items: zones.map(presentZone),
    }));
  });

  r.patch("/warehouses/:warehouseId/zones/:zoneId", async (req, res) => {
    const params = zoneParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = updateZone.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.zones.update(params.data.warehouseId, params.data.zoneId, body.data),
      200,
      presentZone,
    );
  });

  // ---- locations

  r.post("/warehouses/:warehouseId/locations", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = createLocation.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.locations.create(params.data.warehouseId, body.data),
      201,
      presentLocation,
    );
  });

  r.get("/warehouses/:warehouseId/locations", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const query = listLocationsQuery.safeParse(req.query);
    if (!query.success) return res.status(400).json(query.error.flatten());
    const { zoneId, type, status, active, after, limit } = query.data;
    const result = await deps.locations.list(params.data.warehouseId, {
      zoneId,
      typeCode: type,
      status,
      isActive: active === undefined ? undefined : active === "true",
      after,
      limit,
    });
    return send(res, result, 200, (page) => ({
      items: page.items.map(presentLocation),
      nextAfter: page.nextAfter,
    }));
  });

  r.get("/warehouses/:warehouseId/locations/:code", async (req, res) => {
    const params = locationParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(
      res,
      await deps.locations.get(params.data.warehouseId, params.data.code),
      200,
      presentLocation,
    );
  });

  r.patch("/warehouses/:warehouseId/locations/:code", async (req, res) => {
    const params = locationParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = updateLocation.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.locations.update(params.data.warehouseId, params.data.code, body.data),
      200,
      presentLocation,
    );
  });

  // ---- reference data (organisation-wide)

  r.get("/location-types", async (_req, res) => {
    const items = await deps.referenceData.listLocationTypes();
    return res.json({ items: items.map(presentType) });
  });

  r.post("/location-types", async (req, res) => {
    const body = createLocationType.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.referenceData.createLocationType(body.data), 201, presentType);
  });

  r.get("/storage-classes", async (_req, res) => {
    const items = await deps.referenceData.listStorageClasses();
    return res.json({ items: items.map(presentClass) });
  });

  r.post("/storage-classes", async (req, res) => {
    const body = createStorageClass.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.referenceData.createStorageClass(body.data), 201, presentClass);
  });

  return r;
}
