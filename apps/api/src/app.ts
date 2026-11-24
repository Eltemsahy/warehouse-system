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
  MasterDataReferences,
  PgLedgerAuditor,
  PgStockLedger,
} from "../../../modules/inventory/index.js";
import {
  createCatalogModule,
  InMemoryCatalogRepository,
  PgCatalogRepository,
} from "../../../modules/catalog/index.js";
import {
  createIdentityModule,
  InMemoryIdentityRepository,
  InMemorySessionRepository,
  PgIdentityRepository,
  PgSessionRepository,
} from "../../../modules/identity/index.js";
import {
  createLocationsModule,
  InMemoryLocationsRepository,
  PgLocationsRepository,
} from "../../../modules/locations/index.js";
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
    const readiness: ReadinessCheck[] = [{ name: "database", check: () => pool.query("SELECT 1") }];
    return {
      ledger: new PgStockLedger(pool),
      auditor: new PgLedgerAuditor(pool),
      dispatcher: new PgOutbox(pool),
      idempotencyStore: new PgIdempotencyStore(pool),
      locationsRepository: new PgLocationsRepository(pool),
      catalogRepository: new PgCatalogRepository(pool),
      identityRepository: new PgIdentityRepository(pool),
      sessionRepository: new PgSessionRepository(pool),
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
    locationsRepository: new InMemoryLocationsRepository(),
    catalogRepository: new InMemoryCatalogRepository(),
    identityRepository: new InMemoryIdentityRepository(),
    sessionRepository: new InMemorySessionRepository(),
    readiness,
  };
}

/** Composition root: the only place modules are wired together. */
export function buildApp() {
  const app = express();
  // Behind a reverse proxy every request comes from the proxy's address unless Express is told
  // how many proxies to trust, and the per-address login limit would then lock everyone out
  // together. Set TRUST_PROXY to the number of proxies in front of the app (0 or unset: none).
  const proxyHops = Number.parseInt(process.env.TRUST_PROXY ?? "0", 10);
  if (proxyHops > 0) app.set("trust proxy", proxyHops);

  const lifecycle = { shuttingDown: false };
  const isShuttingDown = () => lifecycle.shuttingDown;

  const {
    ledger,
    auditor,
    dispatcher,
    idempotencyStore,
    locationsRepository,
    catalogRepository,
    identityRepository,
    sessionRepository,
    readiness,
  } = createPersistence();

  // Probes first: cheap, unauthenticated, and unaffected by the middleware below.
  app.use(connectionCloseWhenShuttingDown(isShuttingDown));
  app.use(healthRouter({ checks: readiness, isShuttingDown }));

  app.use(express.json());

  const bus = new InMemoryEventBus();
  bus.subscribe("inventory.StockAdjusted", (e) => logger.info("event", { name: e.name }));

  // Replaying a request with the same Idempotency-Key returns the original response
  // and never runs a second write (TRD s5.5). Must come after express.json().
  // Identity is left out: its requests carry passwords and its responses carry session tokens,
  // which must never be stored. Its writes are safe to repeat anyway (unique usernames,
  // idempotent role grants, versioned updates).
  app.use(idempotency(idempotencyStore, { skip: (req) => req.path.startsWith("/identity") }));

  const locations = createLocationsModule({ repository: locationsRepository });
  const catalog = createCatalogModule({ repository: catalogRepository });
  // Access grants name warehouses: identity asks locations whether they exist (soft reference).
  const identity = createIdentityModule({
    repository: identityRepository,
    sessions: sessionRepository,
    warehouses: { exists: async (id) => (await locations.getWarehouse(id)) !== null },
  });

  // Inventory only takes stock for warehouses, locations and SKUs that exist in the master
  // data, and only adds stock to active ones (P1-5). The modules meet only here.
  const inventory = createInventoryModule({
    ledger,
    auditor,
    references: new MasterDataReferences(locations, catalog),
  });
  app.use("/inventory", inventory.router);
  app.use("/locations", locations.router);
  app.use("/catalog", catalog.router);
  app.use("/identity", identity.router);

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
