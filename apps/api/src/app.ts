import express from "express";
import {
  InMemoryEventBus,
  InMemoryOutbox,
  OutboxRelay,
  PgOutbox,
} from "../../../shared/events/index.js";
import {
  idempotency,
  InMemoryIdempotencyStore,
  PgIdempotencyStore,
} from "../../../shared/http/index.js";
import { DailyJob } from "../../../shared/jobs/index.js";
import { logger } from "../../../shared/observability/index.js";
import {
  createInventoryModule,
  InMemoryLedger,
  PgLedgerAuditor,
  PgStockLedger,
} from "../../../modules/inventory/index.js";
import { config } from "./config.js";
import { pool } from "./db.js";

/** The ledger, the outbox, the idempotency records and the auditor share one store. */
function createPersistence() {
  if (config.LEDGER_DRIVER === "postgres") {
    return {
      ledger: new PgStockLedger(pool),
      auditor: new PgLedgerAuditor(pool),
      dispatcher: new PgOutbox(pool),
      idempotencyStore: new PgIdempotencyStore(pool),
    };
  }
  const outbox = new InMemoryOutbox();
  return {
    ledger: new InMemoryLedger(outbox),
    auditor: undefined, // the in-memory ledger keeps no separate cache to audit
    dispatcher: outbox,
    idempotencyStore: new InMemoryIdempotencyStore(),
  };
}

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

  const { ledger, auditor, dispatcher, idempotencyStore } = createPersistence();

  // Replaying a request with the same Idempotency-Key returns the original response
  // and never runs a second write (TRD s5.5). Must come after express.json().
  app.use(idempotency(idempotencyStore));

  const inventory = createInventoryModule({ ledger, auditor });
  app.use("/inventory", inventory.router);

  // Subscribers only ever see committed events, delivered at least once, and a failing
  // subscriber is retried by the relay instead of failing the HTTP request (TRD G2, G3).
  const relay = new OutboxRelay(dispatcher, (e) => bus.publish([e]));

  // Nightly ledger-vs-stock_levels reconciliation (P0-8). A mismatch is logged at error level.
  const jobs: DailyJob[] = [];
  const checkIntegrity = inventory.checkIntegrity;
  if (checkIntegrity) {
    jobs.push(
      new DailyJob("ledger-integrity", config.LEDGER_INTEGRITY_HOUR_UTC, () =>
        checkIntegrity.execute(),
      ),
    );
  }

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return { app, relay, jobs };
}