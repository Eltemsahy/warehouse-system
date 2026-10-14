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
import {
  connectionCloseWhenShuttingDown,
  errorHandler,
  healthRouter,
  notFoundHandler,
  type ReadinessCheck,
} from "./http.js";

/** The ledger, the outbox, the idempotency records and the auditor share one store. */
function createPersistence() {
  if (config.LEDGER_DRIVER === "postgres") {
    const readiness: ReadinessCheck[] = [
      { name: "database", check: () => pool.query("SELECT 1") },
    ];
    return {
      ledger: new PgStockLedger(pool),
      auditor: new PgLedgerAuditor(pool),
      dispatcher: new PgOutbox(pool),
      idempotencyStore: new PgIdempotencyStore(pool),
      readiness,
    };
  }
  const outbox = new InMemoryOutbox();
  const readiness: ReadinessCheck[] = []; // nothing external to wait for
  return {
    ledger: new InMemoryLedger(outbox),
    auditor: undefined, // the in-memory ledger keeps no separate cache to audit
    dispatcher: outbox,
    idempotencyStore: new InMemoryIdempotencyStore(),
    readiness,
  };
}

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  const lifecycle = { shuttingDown: false };
  const isShuttingDown = () => lifecycle.shuttingDown;

  const { ledger, auditor, dispatcher, idempotencyStore, readiness } = createPersistence();

  // Probes first: cheap, unauthenticated, and unaffected by the middleware below.
  app.use(connectionCloseWhenShuttingDown(isShuttingDown));
  app.use(healthRouter({ checks: readiness, isShuttingDown }));

  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

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

  // Must stay last: unknown routes get a JSON 404, and errors thrown by any route get a
  // JSON 500 (Express 5 forwards async errors here).
  app.use(notFoundHandler);
  app.use(errorHandler);

  return {
    app,
    relay,
    jobs,
    /** Flips /health/ready to 503 and asks clients to close their connections. */
    beginShutdown: () => {
      lifecycle.shuttingDown = true;
    },
  };
}