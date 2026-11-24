import type { Pool } from "pg";
import type { LoginAttempt, NewSession, SessionRepository } from "../application/ports.js";
import { NotFoundError } from "../domain/errors.js";
import type { Session } from "../domain/model.js";

const FOREIGN_KEY_VIOLATION = "23503";

export class PgSessionRepository implements SessionRepository {
  constructor(private pool: Pool) {}

  async createSession(s: NewSession): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO identity.session (id, user_id, token_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [s.id, s.userId, s.tokenHash, s.issuedAt, s.expiresAt],
      );
    } catch (e) {
      if ((e as { code?: string }).code === FOREIGN_KEY_VIOLATION) throw new NotFoundError("user");
      throw e;
    }
  }

  async findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      issued_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, user_id, issued_at, expires_at, revoked_at
         FROM identity.session WHERE token_hash = $1`,
      [tokenHash],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id,
          userId: r.user_id,
          issuedAt: r.issued_at,
          expiresAt: r.expires_at,
          revokedAt: r.revoked_at,
        }
      : null;
  }

  async revokeSession(id: string, at: Date): Promise<boolean> {
    const res = await this.pool.query(
      "UPDATE identity.session SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [id, at],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async revokeUserSessions(userId: string, at: Date, exceptSessionId?: string): Promise<number> {
    const res = await this.pool.query(
      `UPDATE identity.session SET revoked_at = $2
        WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [userId, at, exceptSessionId ?? null],
    );
    return res.rowCount ?? 0;
  }

  async recordLoginAttempt(a: LoginAttempt): Promise<void> {
    await this.pool.query(
      "INSERT INTO identity.login_attempt (username, ip, success, at) VALUES ($1, $2, $3, $4)",
      [a.username, a.ip, a.success, a.at],
    );
  }

  async countUsernameFailures(username: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity.login_attempt
        WHERE username = $1 AND NOT success AND at >= $2
          AND at > COALESCE((SELECT max(at) FROM identity.login_attempt
                              WHERE username = $1 AND success), '-infinity'::timestamptz)`,
      [username, since],
    );
    return rows[0]?.n ?? 0;
  }

  async countIpFailures(ip: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM identity.login_attempt WHERE ip = $1 AND NOT success AND at >= $2",
      [ip, since],
    );
    return rows[0]?.n ?? 0;
  }
}
