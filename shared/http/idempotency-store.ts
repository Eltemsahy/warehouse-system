export type BeginResult =
  /** First time this key is seen (or the old record expired): run the request. */
  | { kind: "claimed" }
  /** Same key, same request, already finished: send the stored response again. */
  | { kind: "replay"; status: number; body: unknown }
  /** Same key, same request, still running. */
  | { kind: "in_progress" }
  /** Same key, but a different request. */
  | { kind: "mismatch" };

/** Storage for Idempotency-Key records (TRD s5.5). */
export interface IdempotencyStore {
  /** Atomically claims the key, or reports what already exists for it. */
  begin(key: string, userId: string, requestHash: string, ttlMs: number): Promise<BeginResult>;
  /** Records the response of a claimed key. `body` null means "no body". */
  complete(key: string, userId: string, status: number, body: unknown): Promise<void>;
  /** Drops a claimed, unfinished key so the client can retry. No-op once completed. */
  release(key: string, userId: string): Promise<void>;
  /** Deletes expired records. Returns how many were removed. */
  purgeExpired(): Promise<number>;
}

interface Entry {
  requestHash: string;
  status: number | null;
  body: unknown;
  expiresAt: number;
}

/** For tests and local dev. Behaves like PgIdempotencyStore (see the contract tests). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private entries = new Map<string, Entry>();

  private id = (key: string, userId: string) => `${userId}\u0000${key}`;

  async begin(key: string, userId: string, requestHash: string, ttlMs: number) {
    const id = this.id(key, userId);
    const existing = this.entries.get(id);
    const now = Date.now();
    // No await between the lookup and the write, so claiming is atomic.
    if (!existing || existing.expiresAt <= now) {
      this.entries.set(id, { requestHash, status: null, body: null, expiresAt: now + ttlMs });
      return { kind: "claimed" } as const;
    }
    if (existing.requestHash !== requestHash) return { kind: "mismatch" } as const;
    if (existing.status === null) return { kind: "in_progress" } as const;
    return { kind: "replay", status: existing.status, body: existing.body } as const;
  }

  async complete(key: string, userId: string, status: number, body: unknown) {
    const entry = this.entries.get(this.id(key, userId));
    if (!entry || entry.status !== null) return;
    entry.status = status;
    // JSON round trip so a replayed body has the same shape as one read from jsonb.
    entry.body = body === undefined || body === null ? null : JSON.parse(JSON.stringify(body));
  }

  async release(key: string, userId: string) {
    const id = this.id(key, userId);
    if (this.entries.get(id)?.status === null) this.entries.delete(id);
  }

  async purgeExpired() {
    const now = Date.now();
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}