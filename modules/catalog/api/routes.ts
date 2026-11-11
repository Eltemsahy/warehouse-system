import { Router, type Response } from "express";
import { z } from "zod";
import type { Result } from "../../../shared/kernel/index.js";
import type {
  BarcodeService,
  BarcodeView,
  ScannedBarcode,
} from "../application/barcode-service.js";
import type { CategoryService, CategoryView } from "../application/category-service.js";
import type { ItemDetail, ItemService, ItemView } from "../application/item-service.js";
import type { UomService } from "../application/uom-service.js";
import { ConflictError, NotFoundError, type CatalogError } from "../domain/errors.js";
import {
  BARCODE_MESSAGE,
  BARCODE_PATTERN,
  BARCODE_TYPES,
  CODE_MESSAGE,
  CODE_PATTERN,
  ITEM_STATUSES,
  type ItemUom,
  type Uom,
} from "../domain/model.js";

const code = z.string().regex(CODE_PATTERN, CODE_MESSAGE);
const version = z.number().int().min(1);
const measure = z.number().min(0).nullable().optional();
const hasChanges = (body: Record<string, unknown>) =>
  Object.keys(body).some((k) => k !== "version");

const itemParams = z.object({ sku: code });
const unitParams = z.object({ sku: code, uom: code });
const categoryParams = z.object({ code });
const barcode = z.string().regex(BARCODE_PATTERN, BARCODE_MESSAGE);
const barcodeParams = z.object({ barcode });
const itemBarcodeParams = z.object({ sku: code, barcode });
const addBarcode = z
  .object({ barcode, uom: code, type: z.enum(BARCODE_TYPES).optional() })
  .strict();

const unitInput = z
  .object({
    uom: code,
    qtyInBase: z.number().int().min(1).optional(),
    length: measure,
    width: measure,
    height: measure,
    weight: measure,
  })
  .strict();
const addUnit = unitInput.extend({ qtyInBase: z.number().int().min(1) });
const updateUnit = z
  .object({
    version,
    qtyInBase: z.number().int().min(1).optional(),
    length: measure,
    width: measure,
    height: measure,
    weight: measure,
  })
  .strict()
  .refine(hasChanges, "nothing to update");

const createItem = z
  .object({
    sku: code,
    description: z.string().min(1).max(500),
    baseUom: code,
    category: code.nullable().optional(),
    isLotTracked: z.boolean().optional(),
    isSerialTracked: z.boolean().optional(),
    hasExpiry: z.boolean().optional(),
    shelfLifeDays: z.number().int().min(1).nullable().optional(),
    units: z.array(unitInput).max(20).optional(),
  })
  .strict();
// The tracking flags are deliberately absent: they are fixed when the item is created.
const updateItem = z
  .object({
    version,
    description: z.string().min(1).max(500).optional(),
    category: code.nullable().optional(),
    status: z.enum(ITEM_STATUSES).optional(),
    shelfLifeDays: z.number().int().min(1).nullable().optional(),
  })
  .strict()
  .refine(hasChanges, "nothing to update");

const listItemsQuery = z
  .object({
    status: z.enum(ITEM_STATUSES).optional(),
    category: code.optional(),
    after: code.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const createCategory = z
  .object({ code, name: z.string().min(1).max(120), parent: code.nullable().optional() })
  .strict();
const renameCategory = z.object({ version, name: z.string().min(1).max(120) }).strict();
const createUom = z.object({ code, name: z.string().min(1).max(120) }).strict();

const presentUnit = (u: ItemUom) => ({
  uom: u.uom.code,
  qtyInBase: u.qtyInBase,
  length: u.length,
  width: u.width,
  height: u.height,
  weight: u.weight,
  updatedAt: u.updatedAt,
  version: u.version,
});

const presentItem = (i: ItemView) => ({
  id: i.id,
  sku: i.sku,
  description: i.description,
  category: i.categoryCode,
  baseUom: i.baseUom.code,
  status: i.status,
  isLotTracked: i.isLotTracked,
  isSerialTracked: i.isSerialTracked,
  hasExpiry: i.hasExpiry,
  shelfLifeDays: i.shelfLifeDays,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  version: i.version,
});

const presentDetail = (d: ItemDetail) => ({
  ...presentItem(d.item),
  units: d.units.map(presentUnit),
});
const presentCategory = (c: CategoryView) => ({
  code: c.code,
  name: c.name,
  parent: c.parentCode,
  updatedAt: c.updatedAt,
  version: c.version,
});
const presentUom = (u: Uom) => ({ code: u.code, name: u.name });
const presentBarcode = (b: BarcodeView) => ({
  barcode: b.barcode,
  type: b.type,
  uom: b.uom,
  qtyInBase: b.qtyInBase,
});
const presentScan = (s: ScannedBarcode) => ({
  ...presentBarcode(s),
  item: {
    sku: s.item.sku,
    description: s.item.description,
    status: s.item.status,
    baseUom: s.item.baseUom.code,
  },
});

function statusOf(error: CatalogError): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422;
}

function send<T>(
  res: Response,
  result: Result<T, CatalogError>,
  status: number,
  present: (v: T) => unknown,
): Response {
  if (result.ok) return res.status(status).json(present(result.value));
  return res.status(statusOf(result.error)).json({ error: result.error.message });
}

export interface CatalogRouteDeps {
  items: ItemService;
  categories: CategoryService;
  uoms: UomService;
  barcodes: BarcodeService;
}

/**
 * Mounted at /catalog. A body or query that does not validate answers 400; a missing resource
 * 404; a duplicate code or a stale version 409; a rule broken by valid input 422. PATCH must
 * send the `version` it last read. SKUs and codes can never be changed.
 */
export function catalogRoutes(deps: CatalogRouteDeps) {
  const r = Router();

  // ---- units of measure and categories (organisation-wide)

  r.get("/uoms", async (_req, res) =>
    res.json({ items: (await deps.uoms.list()).map(presentUom) }),
  );

  r.post("/uoms", async (req, res) => {
    const body = createUom.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.uoms.create(body.data), 201, presentUom);
  });

  r.get("/categories", async (_req, res) =>
    res.json({ items: (await deps.categories.list()).map(presentCategory) }),
  );

  r.post("/categories", async (req, res) => {
    const body = createCategory.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.categories.create(body.data), 201, presentCategory);
  });

  r.patch("/categories/:code", async (req, res) => {
    const params = categoryParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = renameCategory.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.categories.rename(params.data.code, body.data),
      200,
      presentCategory,
    );
  });

  // ---- items

  r.post("/items", async (req, res) => {
    const body = createItem.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.items.create(body.data), 201, presentDetail);
  });

  r.get("/items", async (req, res) => {
    const query = listItemsQuery.safeParse(req.query);
    if (!query.success) return res.status(400).json(query.error.flatten());
    return send(res, await deps.items.list(query.data), 200, (page) => ({
      items: page.items.map(presentItem),
      nextAfter: page.nextAfter,
    }));
  });

  r.get("/items/:sku", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.items.get(params.data.sku), 200, presentDetail);
  });

  r.patch("/items/:sku", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = updateItem.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.items.update(params.data.sku, body.data), 200, presentDetail);
  });

  // ---- item units

  r.get("/items/:sku/units", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.items.listUnits(params.data.sku), 200, (units) => ({
      items: units.map(presentUnit),
    }));
  });

  r.post("/items/:sku/units", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = addUnit.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.items.addUnit(params.data.sku, body.data), 201, presentUnit);
  });

  r.patch("/items/:sku/units/:uom", async (req, res) => {
    const params = unitParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = updateUnit.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(
      res,
      await deps.items.updateUnit(params.data.sku, params.data.uom, body.data),
      200,
      presentUnit,
    );
  });

  // ---- barcodes (percent-encode a `/` inside a barcode when you put it in a URL)

  r.post("/items/:sku/barcodes", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = addBarcode.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.barcodes.add(params.data.sku, body.data), 201, presentBarcode);
  });

  r.get("/items/:sku/barcodes", async (req, res) => {
    const params = itemParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.barcodes.list(params.data.sku), 200, (list) => ({
      items: list.map(presentBarcode),
    }));
  });

  r.delete("/items/:sku/barcodes/:barcode", async (req, res) => {
    const params = itemBarcodeParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const result = await deps.barcodes.remove(params.data.sku, params.data.barcode);
    if (result.ok) return res.status(204).end();
    return res.status(statusOf(result.error)).json({ error: result.error.message });
  });

  /** Scan: which item and unit does this barcode identify? */
  r.get("/barcodes/:barcode", async (req, res) => {
    const params = barcodeParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    return send(res, await deps.barcodes.resolve(params.data.barcode), 200, presentScan);
  });

  return r;
}
