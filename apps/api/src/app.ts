import express from "express";
import { InMemoryEventBus } from "../../../shared/events/index.js";
import { logger } from "../../../shared/observability/index.js";
import { createInventoryModule, PgStockLedger } from "../../../modules/inventory/index.js";
import { config } from "./config.js";
import { pool } from "./db.js";

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

  const ledger = config.LEDGER_DRIVER === "postgres" ? new PgStockLedger(pool) : undefined;
  const inventory = createInventoryModule({ bus, ledger });
  app.use("/inventory", inventory.router);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
}
