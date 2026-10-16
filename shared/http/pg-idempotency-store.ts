import type { Pool } from "pg";
import type { BeginResult, IdempotencyStore } from "./idempotency-store.js";

interface Row {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private pool: Pool) {}

  async begin(
    key: string,
    userId: string,
    requestHash: string,
    ttlMs: number,
  ): Promise<BeginResult> {
    // A concurrent duplicate can see the row vanish between the two statements (released
    // after a 5xx), so allow a couple of passes before giving up.
    for (let pass = 0; pass < 3; pass++) {
      // Claim in ONE statement. The primary key serialises concurrent first requests; the
      // WHERE clause lets an expired record be taken over, and leaves a live one alone.
      const claimed = await this.pool.query(
        `INSERT INTO platform.idempotency_key (key, user_id, request_hash, expires_at)
         VALUES ($1, $2, $3, now() + ($4::double precision * interval '1 millisecond'))
         ON CONFLICT (key, user_id) DO UPDATE
           SET request_hash    = EXCLUDED.request_hash,
               response_status = NULL,
               response_body   = NULL,
               created_at      = now(),
               expires_at      = EXCLUDED.expires_at
         WHERE platform.idempotency_key.expires_at <= now()
         RETURNING key`,
        [key, userId, requestHash, ttlMs],
      );
      if (claimed.rowCount) return { kind: "claimed" };

      const { rows } = await this.pool.query<Row>(
        `SELECT request_hash, response_status, response_body
           FROM platform.idempotency_key
          WHERE key = $1 AND user_id = $2`,
        [key, userId],
      );
      const row = rows[0];
      if (!row) continue;
      if (row.request_hash !== requestHash) return { kind: "mismatch" };
      if (row.response_status === null) return { kind: "in_progress" };
      return { kind: "replay", status: row.response_status, body: row.response_body };
    }
    throw new Error("could not claim idempotency key");
  }

  async complete(key: string, userId: string, status: number, body: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE platform.idempotency_key
          SET response_status = $3, response_body = $4::jsonb
        WHERE key = $1 AND user_id = $2 AND response_status IS NULL`,
      [key, userId, status, body === undefined || body === null ? null : JSON.stringify(body)],
    );
  }

  async release(key: string, userId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM platform.idempotency_key
        WHERE key = $1 AND user_id = $2 AND response_status IS NULL`,
      [key, userId],
    );
  }

  async purgeExpired(): Promise<number> {
    const r = await this.pool.query(
      "DELETE FROM platform.idempotency_key WHERE expires_at <= now()",
    );
    return r.rowCount ?? 0;
  }
}
