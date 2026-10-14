import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "../../../shared/observability/index.js";

const { app, relay, jobs } = buildApp();
relay.start();
for (const job of jobs) job.start();
app.listen(config.PORT, () => logger.info("api listening", { port: config.PORT }));
