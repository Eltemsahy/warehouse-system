import { newId, type DomainEvent } from "../../../shared/kernel/index.js";
import type { StockMovement } from "./stock-movement.js";

export const stockAdjusted = (m: StockMovement): DomainEvent<StockMovement> => ({
  id: newId(), name: "inventory.StockAdjusted", occurredAt: new Date(), payload: m,
});

export const stockTransferred = (
  p: { sku: string; from: string; to: string; quantity: number; transferId: string },
): DomainEvent<typeof p> => ({
  id: newId(), name: "inventory.StockTransferred", occurredAt: new Date(), payload: p,
});
