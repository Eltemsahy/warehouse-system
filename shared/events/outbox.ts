import type { DomainEvent } from "../kernel/index.js";
import type { EventHandler } from "./event-bus.js";

export type OutboxStatus = "pending" | "published" | "dead" | "missing";

export interface DispatchOptions {
  /** Maximum number of events claimed in one pass. */
  limit: number;
  /** A delivery that has failed this many times is moved to the dead-letter store. */
  maxAttempts: number;
  /** Delay before the next try, given the number of failed attempts so far (1-based). */
  backoffMs: (failedAttempts: number) => number;
}

export interface DispatchResult {
  delivered: number;
  retried: number;
  deadLettered: number;
}

/**
 * Claims due events, hands each to `handler`, and records the outcome. Delivery is
 * at-least-once: consumers must be idempotent (TRD s5.3). A handler failure never stops the
 * rest of the batch.
 */
export interface OutboxDispatcher {
  dispatch(handler: EventHandler, options: DispatchOptions): Promise<DispatchResult>;
}

/** Read side, for tests and operational tooling. */
export interface OutboxInspector {
  status(eventId: string): Promise<OutboxStatus>;
}

interface Row {
  event: DomainEvent;
  attempts: number;
  nextAttemptAt: number;
  published: boolean;
}

/** For tests and local dev. Behaves like PgOutbox (see tests/contract/outbox.contract.ts). */
export class InMemoryOutbox implements OutboxDispatcher, OutboxInspector {
  private rows: Row[] = [];
  private claimed = new Set<string>();
  private dead = new Set<string>();

  /** Synchronous on purpose, so InMemoryLedger can call it inside its atomic section. */
  add(events: readonly DomainEvent[]): void {
    for (const e of events) {
      // JSON round trip so delivered payloads have the same shape as from Postgres (jsonb).
      const event = { ...e, payload: JSON.parse(JSON.stringify(e.payload)) as unknown };
      this.rows.push({ event, attempts: 0, nextAttemptAt: 0, published: false });
    }
  }

  async dispatch(handler: EventHandler, options: DispatchOptions): Promise<DispatchResult> {
    const now = Date.now();
    const batch = this.rows
      .filter((r) => !r.published && !this.claimed.has(r.event.id) && r.nextAttemptAt <= now)
      .slice(0, options.limit);
    for (const row of batch) this.claimed.add(row.event.id);

    const result: DispatchResult = { delivered: 0, retried: 0, deadLettered: 0 };
    for (const row of batch) {
      try {
        await handler(row.event);
        row.published = true;
        result.delivered += 1;
      } catch {
        row.attempts += 1;
        if (row.attempts >= options.maxAttempts) {
          this.rows = this.rows.filter((r) => r !== row);
          this.dead.add(row.event.id);
          result.deadLettered += 1;
        } else {
          row.nextAttemptAt = Date.now() + options.backoffMs(row.attempts);
          result.retried += 1;
        }
      } finally {
        this.claimed.delete(row.event.id);
      }
    }
    return result;
  }

  async status(eventId: string): Promise<OutboxStatus> {
    if (this.dead.has(eventId)) return "dead";
    const row = this.rows.find((r) => r.event.id === eventId);
    if (!row) return "missing";
    return row.published ? "published" : "pending";
  }
}