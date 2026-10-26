import { Router } from "express";
import { z } from "zod";
import type { AdjustStock } from "../application/adjust-stock.js";
import type { TransferStock } from "../application/transfer-stock.js";
import type { StockLedger } from "../application/ports.js";

// ADR 0004: business codes are exact-match text, 1 to 64 characters.
const code = z
  .string()
  .regex(
    /^[A-Za-z0-9._/-]{1,64}$/,
    "must be 1 to 64 letters, digits, dot, underscore, slash or hyphen",
  );
const warehouseId = z.string().uuid();

const warehouseParams = z.object({ warehouseId });
const balanceParams = z.object({ warehouseId, sku: code, locationId: code });
const adjustSchema = z.object({
  sku: code,
  locationId: code,
  delta: z.number().int(),
  reason: z.string().min(1),
});
const transferSchema = z.object({
  sku: code,
  from: code,
  to: code,
  quantity: z.number().int().positive(),
});

/**
 * Every route is scoped to a warehouse through the path (ADR 0004). Once authentication
 * exists, one middleware can check /warehouses/:warehouseId/* against the user's access.
 */
export function inventoryRoutes(deps: {
  adjust: AdjustStock;
  transfer: TransferStock;
  ledger: StockLedger;
}) {
  const r = Router();

  r.post("/warehouses/:warehouseId/adjustments", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = adjustSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    const result = await deps.adjust.execute({
      warehouseId: params.data.warehouseId,
      ...body.data,
    });
    return result.ok
      ? res.status(201).json(result.value)
      : res.status(422).json({ error: result.error.message });
  });

  r.post("/warehouses/:warehouseId/transfers", async (req, res) => {
    const params = warehouseParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const body = transferSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    const result = await deps.transfer.execute({
      warehouseId: params.data.warehouseId,
      ...body.data,
    });
    return result.ok
      ? res.status(201).json(result.value)
      : res.status(422).json({ error: result.error.message });
  });

  r.get("/warehouses/:warehouseId/skus/:sku/locations/:locationId/balance", async (req, res) => {
    const params = balanceParams.safeParse(req.params);
    if (!params.success) return res.status(400).json(params.error.flatten());
    const { warehouseId, sku, locationId } = params.data;
    return res.json({
      warehouseId,
      sku,
      locationId,
      balance: await deps.ledger.balance(warehouseId, sku, locationId),
    });
  });

  return r;
}
