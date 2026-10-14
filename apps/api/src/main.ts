import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db.js";
import { createShutdown } from "./lifecycle.js";
import { logger } from "../../../shared/observability/index.js";

const { app, relay, jobs, beginShutdown } = buildApp();
relay.start();
for (const job of jobs) job.start();

const server = app.listen(config.PORT, () => logger.info("api listening", { port: config.PORT }));

// SIGTERM is what Docker, Kubernetes and `tsx watch` send; SIGINT is Ctrl+C. Kept below Docker's
// default 10 s stop grace period so we exit by ourselves before being killed.
const shutdown = createShutdown({
  server,
  onStart: beginShutdown,
  timeoutMs: 8_000,
  steps: [
    { name: "outbox relay", run: () => relay.stop() },
    ...jobs.map((job) => ({ name: `job ${job.name}`, run: () => job.stop() })),
    { name: "database pool", run: () => pool.end() },
  ],
});

// `once`: a second Ctrl+C falls back to the default behaviour and kills the process.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).then((code) => process.exit(code));
  });
}