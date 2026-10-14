import { logger } from "../../../shared/observability/index.js";

/** The part of http.Server that shutdown needs. */
export interface HttpServerLike {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?: () => void;
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export interface ShutdownOptions {
  server: HttpServerLike;
  /** Called first: e.g. make /health/ready answer 503 so traffic is steered away. */
  onStart?: () => void;
  /** Run in order once the server has finished its in-flight requests. */
  steps: ShutdownStep[];
  /** Give up after this long and report failure. Docker's default grace period is 10 s. */
  timeoutMs?: number;
  log?: Pick<typeof logger, "info" | "error">;
}

function closeServer(server: HttpServerLike): Promise<void> {
  return new Promise((resolve, reject) => {
    // Stops accepting connections; the callback fires when in-flight requests are done.
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeIdleConnections?.();
  });
}

/**
 * Builds the shutdown routine: drain HTTP, then stop the outbox relay and jobs, then close the
 * database pool. It never exits the process itself: it resolves to the exit code (0 clean,
 * 1 if a step failed or the timeout hit) and the caller decides. Calling it again returns the
 * same result instead of running twice.
 */
export function createShutdown(options: ShutdownOptions): (reason: string) => Promise<0 | 1> {
  const log = options.log ?? logger;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let pending: Promise<0 | 1> | undefined;

  async function run(reason: string): Promise<0 | 1> {
    log.info("shutting down", { reason });
    options.onStart?.();

    const work = (async (): Promise<0 | 1> => {
      let failed = false;
      try {
        await closeServer(options.server);
        log.info("http server drained");
      } catch (e) {
        failed = true;
        log.error("closing the http server failed", { error: String(e) });
      }
      for (const step of options.steps) {
        try {
          await step.run();
          log.info("stopped", { step: step.name });
        } catch (e) {
          failed = true;
          log.error("shutdown step failed", { step: step.name, error: String(e) });
        }
      }
      return failed ? 1 : 0;
    })();

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<1>((resolve) => {
      timer = setTimeout(() => {
        log.error("shutdown timed out, forcing exit", { timeoutMs });
        resolve(1);
      }, timeoutMs);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return (reason) => (pending ??= run(reason));
}