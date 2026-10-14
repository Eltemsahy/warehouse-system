import { Router, type ErrorRequestHandler, type RequestHandler } from "express";
import { logger } from "../../../shared/observability/index.js";

export interface ReadinessCheck {
  name: string;
  /** Resolves when the dependency is usable; rejects (or hangs) when it is not. */
  check: () => Promise<unknown>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * GET /health        liveness: the process is up. Touches no dependency.
 * GET /health/ready  readiness: 200 only if every check passes and we are not shutting down;
 *                    otherwise 503, so load balancers stop sending traffic.
 * Both are exempt from authentication (TRD s6).
 */
export function healthRouter(options: {
  checks: ReadinessCheck[];
  isShuttingDown: () => boolean;
  timeoutMs?: number;
}) {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get("/health/ready", async (_req, res) => {
    if (options.isShuttingDown()) {
      res.status(503).json({ status: "shutting_down" });
      return;
    }
    const results = await Promise.all(
      options.checks.map(async ({ name, check }): Promise<[string, "ok" | "failed"]> => {
        try {
          await withTimeout(check(), timeoutMs);
          return [name, "ok"];
        } catch (e) {
          // Details go to the log, not to the (unauthenticated) caller.
          logger.warn("readiness check failed", {
            check: name,
            error: e instanceof Error ? e.message : String(e),
          });
          return [name, "failed"];
        }
      }),
    );
    const ready = results.every(([, status]) => status === "ok");
    res
      .status(ready ? 200 : 503)
      .json({ status: ready ? "ready" : "unavailable", checks: Object.fromEntries(results) });
  });

  return router;
}

/** While shutting down, ask clients to close their keep-alive connections after replying. */
export function connectionCloseWhenShuttingDown(isShuttingDown: () => boolean): RequestHandler {
  return (_req, res, next) => {
    if (isShuttingDown()) res.setHeader("Connection", "close");
    next();
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "not found" });
};

function statusOf(err: unknown): number {
  if (typeof err === "object" && err !== null) {
    const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
    for (const candidate of [status, statusCode]) {
      if (typeof candidate === "number" && candidate >= 400 && candidate < 600) return candidate;
    }
  }
  return 500;
}

/**
 * Last middleware. With Express 5 an error thrown or rejected in any route lands here.
 * 4xx errors (for example malformed JSON) keep their message; 5xx are logged and answered
 * with a generic message, so internals never leak.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = statusOf(err);
  if (status >= 500) {
    logger.error("unhandled error", {
      method: req.method,
      url: req.originalUrl,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: "internal server error" });
    return;
  }
  res.status(status).json({ error: err instanceof Error ? err.message : "bad request" });
};