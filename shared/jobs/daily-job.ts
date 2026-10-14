import { logger } from "../observability/index.js";

/** Milliseconds from `now` until the next time the clock reads `hourUtc`:00 UTC. */
export function msUntilNextRun(now: Date, hourUtc: number): number {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Runs `run` once a day at `hourUtc`:00 UTC. In-process and deliberately small: it does not
 * remember past runs and does not coordinate between processes, so with several instances
 * each one runs the job. Failures are logged, never thrown.
 */
export class DailyJob {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private running = false;

  constructor(
    readonly name: string,
    private hourUtc: number,
    private run: () => Promise<unknown>,
    private clock: () => Date = () => new Date(),
  ) {
    if (!Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23) {
      throw new RangeError(`hourUtc must be an integer from 0 to 23, got ${hourUtc}`);
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
    logger.info("job scheduled", { job: this.name, hourUtc: this.hourUtc });
  }

  /** Stops scheduling and waits for a run in progress to finish. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  /** Runs the job now. Errors are logged, not thrown. Also useful for manual triggers. */
  async runNow(): Promise<void> {
    try {
      await this.run();
    } catch (e) {
      logger.error("job failed", {
        job: this.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private schedule(): void {
    const delay = msUntilNextRun(this.clock(), this.hourUtc);
    this.timer = setTimeout(() => {
      this.inFlight = this.runNow().finally(() => {
        if (this.running) this.schedule();
      });
    }, delay);
  }
}