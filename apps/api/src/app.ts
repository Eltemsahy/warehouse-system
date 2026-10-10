import express from "express";
import {
  InMemoryEventBus,
  InMemoryOutbox,
  OutboxRelay,
  PgOutbox,
} from "../../../shared/events/index.js";
import { logger } from "../../../shared/observability/index.js";
import {
  createInventoryModule,
  InMemoryLedger,
  PgStockLedger,
} from "../../../modules/inventory/index.js";
import { config } from "./config.js";
import { pool } from "./db.js";

/** The ledger and the outbox it writes to must be backed by the same store. */
function createPersistence() {
  if (config.LEDGER_DRIVER === "postgres") {
    return { ledger: new PgStockLedger(pool), dispatcher: new PgOutbox(pool) };
  }
  const outbox = new InMemoryOutbox();
  return { ledger: new InMemoryLedger(outbox), dispatcher: outbox };
}

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

  const { ledger, dispatcher } = createPersistence();
  const inventory = createInventoryModule({ ledger });
  app.use("/inventory", inventory.router);

  // Subscribers only ever see committed events, delivered at least once, and a failing
  // subscriber is retried by the relay instead of failing the HTTP request (TRD G2, G3).
  const relay = new OutboxRelay(dispatcher, (e) => bus.publish([e]));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return { app, relay };
}