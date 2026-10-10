import type { Pool, PoolClient } from "pg";
import type { DomainEvent } from "../kernel/index.js";
import type { EventHandler } from "./event-bus.js";
import type {
  DispatchOptions,
  DispatchResult,
  OutboxDispatcher,
  OutboxInspector,
  OutboxStatus,
} from "./outbox.js";

/**
 * Writes events to platform.outbox using the CALLER'S transaction client, so the events
 * commit or roll back together with the state change (TRD s5.4).
 */
export async function insertOutboxEvents(
  client: PoolClient,
  events: readonly DomainEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const values: unknown[] = [];
  const tuples = events.map((e, i) => {
    values.push(e.id, e.name, JSON.stringify(e.payload), e.occurredAt);
    const o = i * 4;
    return `($${o + 1}, $${o + 2}, $${o + 3}::jsonb, $${o + 4})`;
  });
  await client.query(
    `INSERT INTO platform.outbox (id, name, payload, occurred_at) VALUES ${tuples.join(", ")}`,
    values,
  );
}

interface OutboxRow {
  id: string;
  name: string;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Relay side of the outbox. Rows are claimed with FOR UPDATE SKIP LOCKED inside a
 * transaction that stays open while they are delivered, so concurrent relays never take the
 * same row, and a crash mid-batch rolls back and leaves every row pending (nothing is lost).
 */
export class PgOutbox implements OutboxDispatcher, OutboxInspector {
  constructor(private pool: Pool) {}

  async dispatch(handler: EventHandler, options: DispatchOptions): Promise<DispatchResult> {
    const result: DispatchResult = { delivered: 0, retried: 0, deadLettered: 0 };
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, name, payload, occurred_at, attempts
           FROM platform.outbox
          WHERE published_at IS NULL AND next_attempt_at <= now()
          ORDER BY occurred_at, id
          LIMIT $1
            FOR UPDATE SKIP LOCKED`,
        [options.limit],
      );

      for (const row of rows) {
        try {
          await handler({
            id: row.id,
            name: row.name,
            occurredAt: row.occurred_at,
            payload: row.payload,
          });
          await client.query("UPDATE platform.outbox SET published_at = now() WHERE id = $1", [
            row.id,
          ]);
          result.delivered += 1;
        } catch (e) {
          const attempts = row.attempts + 1;
          const message = errorMessage(e);
          if (attempts >= options.maxAttempts) {
            await client.query(
              `INSERT INTO platform.outbox_dead_letter
                 (outbox_id, name, payload, occurred_at, attempts, last_error)
               VALUES ($1, $2, $3::jsonb, $4, $5, $6)`,
              [row.id, row.name, JSON.stringify(row.payload), row.occurred_at, attempts, message],
            );
            await client.query("DELETE FROM platform.outbox WHERE id = $1", [row.id]);
            result.deadLettered += 1;
          } else {
            await client.query(
              `UPDATE platform.outbox
                  SET attempts = $2,
                      last_error = $3,
                      next_attempt_at = now() + ($4::double precision * interval '1 millisecond')
                WHERE id = $1`,
              [row.id, attempts, message, options.backoffMs(attempts)],
            );
            result.retried += 1;
          }
        }
      }

      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async status(eventId: string): Promise<OutboxStatus> {
    const live = await this.pool.query<{ published_at: Date | null }>(
      "SELECT published_at FROM platform.outbox WHERE id = $1",
      [eventId],
    );
    const row = live.rows[0];
    if (row) return row.published_at ? "published" : "pending";
    const dead = await this.pool.query(
      "SELECT 1 FROM platform.outbox_dead_letter WHERE outbox_id = $1",
      [eventId],
    );
    return dead.rowCount ? "dead" : "missing";
  }
}