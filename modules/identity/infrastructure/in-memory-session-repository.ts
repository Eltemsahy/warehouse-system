import type { LoginAttempt, NewSession, SessionRepository } from "../application/ports.js";
import type { Session } from "../domain/model.js";

const copy = <T>(value: T): T => structuredClone(value);

/** For tests and local development. Honours the same contract as PgSessionRepository. */
export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session & { tokenHash: string }>();
  private attempts: LoginAttempt[] = [];

  async createSession(s: NewSession) {
    this.sessions.set(s.id, {
      id: s.id,
      userId: s.userId,
      tokenHash: s.tokenHash,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      revokedAt: null,
    });
  }

  async findSessionByTokenHash(tokenHash: string) {
    for (const { tokenHash: stored, ...session } of this.sessions.values()) {
      if (stored === tokenHash) return copy(session);
    }
    return null;
  }

  async revokeSession(id: string, at: Date) {
    const s = this.sessions.get(id);
    if (!s || s.revokedAt) return false;
    s.revokedAt = at;
    return true;
  }

  async revokeUserSessions(userId: string, at: Date, exceptSessionId?: string) {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.id !== exceptSessionId && !s.revokedAt) {
        s.revokedAt = at;
        n++;
      }
    }
    return n;
  }

  async recordLoginAttempt(a: LoginAttempt) {
    this.attempts.push(copy(a));
  }

  async countUsernameFailures(username: string, since: Date) {
    const mine = this.attempts.filter((a) => a.username === username);
    const lastSuccess = Math.max(
      -Infinity,
      ...mine.filter((a) => a.success).map((a) => a.at.getTime()),
    );
    return mine.filter(
      (a) => !a.success && a.at.getTime() >= since.getTime() && a.at.getTime() > lastSuccess,
    ).length;
  }

  async countIpFailures(ip: string, since: Date) {
    return this.attempts.filter(
      (a) => a.ip === ip && !a.success && a.at.getTime() >= since.getTime(),
    ).length;
  }
}
