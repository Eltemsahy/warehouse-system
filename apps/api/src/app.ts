import express from "express";
import { InMemoryEventBus } from "../../../shared/events/index.js";
import { logger } from "../../../shared/observability/index.js";
import { createInventoryModule } from "../../../modules/inventory/index.js";

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

  const inventory = createInventoryModule({ bus });
  app.use("/inventory", inventory.router);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
}
