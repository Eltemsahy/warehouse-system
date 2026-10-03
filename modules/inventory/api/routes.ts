import { Router } from "express";
import { z } from "zod";
import type { AdjustStock } from "../application/adjust-stock.js";
import type { TransferStock } from "../application/transfer-stock.js";
import type { StockLedger } from "../application/ports.js";

const adjustSchema = z.object({
  sku: z.string().min(1), locationId: z.string().min(1),
  delta: z.number().int(), reason: z.string().min(1),
});
const transferSchema = z.object({
  sku: z.string().min(1), from: z.string().min(1), to: z.string().min(1),
  quantity: z.number().int().positive(),
});

export function inventoryRoutes(deps: { adjust: AdjustStock; transfer: TransferStock; ledger: StockLedger }) {
  const r = Router();

  r.post("/adjustments", async (req, res) => {
    const body = adjustSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    const result = await deps.adjust.execute(body.data);
    return result.ok ? res.status(201).json(result.value) : res.status(422).json({ error: result.error.message });
  });

  r.post("/transfers", async (req, res) => {
    const body = transferSchema.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    const result = await deps.transfer.execute(body.data);
    return result.ok ? res.status(201).json(result.value) : res.status(422).json({ error: result.error.message });
  });

  r.get("/:sku/locations/:locationId/balance", async (req, res) => {
    const { sku, locationId } = req.params;
    res.json({ sku, locationId, balance: await deps.ledger.balance(sku, locationId) });
  });

  return r;
}
