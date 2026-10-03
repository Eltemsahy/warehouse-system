import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "../../../shared/observability/index.js";

buildApp().listen(config.PORT, () => logger.info("api listening", { port: config.PORT }));
