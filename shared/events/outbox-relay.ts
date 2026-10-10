import { logger } from "../observability/index.js";
import type { EventHandler } from "./event-bus.js";
import type { DispatchOptions, OutboxDispatcher } from "./outbox.js";

export interface OutboxRelayOptions {
  /** Pause between polls when the outbox is empty. Default 1000. */
  pollIntervalMs?: number;
  /** Events claimed per pass. Default 50. */
  batchSize?: number;
  /** Failed deliveries before an event is dead-lettered. Default 8. */
  maxAttempts?: number;
  /** First retry delay; doubles per failure up to maxBackoffMs. Default 1000. */
  baseBackoffMs?: number;
  /** Cap on the retry delay. Default 300000 (5 minutes). */
  maxBackoffMs?: number;
}

/** Polls an OutboxDispatcher and hands committed events to `handler` (e.g. the event bus). */
export class OutboxRelay {
  private readonly pollIntervalMs: number;
  private readonly dispatchOptions: DispatchOptions;
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private running = false;

  constructor(
    private dispatcher: OutboxDispatcher,
    private handler: EventHandler,
    options: OutboxRelayOptions = {},
  ) {
    const base = options.baseBackoffMs ?? 1_000;
    const cap = options.maxBackoffMs ?? 300_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.dispatchOptions = {
      limit: options.batchSize ?? 50,
      maxAttempts: options.maxAttempts ?? 8,
      backoffMs: (failedAttempts) => Math.min(base * 2 ** failedAttempts, cap),
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  /** Stops polling and waits for the pass in progress to finish. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }

  /** One dispatch pass. Returns how many events were handled (delivered, retried or dead). */
  async flushOnce(): Promise<number> {
    const r = await this.dispatcher.dispatch(this.handler, this.dispatchOptions);
    if (r.retried > 0) logger.warn("outbox delivery failed, will retry", { retried: r.retried });
    if (r.deadLettered > 0) {
      logger.error("outbox events dead-lettered", { deadLettered: r.deadLettered });
    }
    return r.delivered + r.retried + r.deadLettered;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.cycle();
    }, delayMs);
  }

  private async cycle(): Promise<void> {
    let delayMs = this.pollIntervalMs;
    try {
      // A full batch means there is probably more waiting: go again straight away.
      if ((await this.flushOnce()) >= this.dispatchOptions.limit) delayMs = 0;
    } catch (e) {
      logger.error("outbox relay pass failed", { error: e instanceof Error ? e.message : String(e) });
    }
    if (this.running) this.schedule(delayMs);
  }
}