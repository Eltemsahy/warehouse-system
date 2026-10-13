import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdempotencyStore } from "../../shared/http/index.js";

const key = () => `key-${randomUUID()}`;
const user = () => `user-${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HOUR = 60 * 60 * 1000;

/**
 * The IdempotencyStore contract (TRD s5.5, Implementation Plan P0-7). Every store must pass
 * this exact suite.
 */
export function idempotencyStoreContract(
  name: string,
  factory: () => IdempotencyStore,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`IdempotencyStore contract: ${name}`, () => {
    it("claims a new key", async () => {
      const store = factory();
      expect(await store.begin(key(), user(), "h1", HOUR)).toEqual({ kind: "claimed" });
    });

    it("reports in_progress for the same request while it is unfinished", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      expect(await store.begin(k, u, "h1", HOUR)).toEqual({ kind: "in_progress" });
    });

    it("replays the recorded response once the request has completed", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      await store.complete(k, u, 201, { id: "m-1", nested: { n: 1 } });
      expect(await store.begin(k, u, "h1", HOUR)).toEqual({
        kind: "replay",
        status: 201,
        body: { id: "m-1", nested: { n: 1 } },
      });
    });

    it("replays a response that has no body", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      await store.complete(k, u, 204, null);
      expect(await store.begin(k, u, "h1", HOUR)).toEqual({
        kind: "replay",
        status: 204,
        body: null,
      });
    });

    it("reports a mismatch when the key is reused for a different request", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      expect(await store.begin(k, u, "other", HOUR)).toEqual({ kind: "mismatch" });
      await store.complete(k, u, 201, {});
      expect(await store.begin(k, u, "other", HOUR)).toEqual({ kind: "mismatch" });
    });

    it("scopes keys per user", async () => {
      const store = factory();
      const k = key();
      await store.begin(k, user(), "h1", HOUR);
      expect(await store.begin(k, user(), "h1", HOUR)).toEqual({ kind: "claimed" });
    });

    it("lets the client retry after an unfinished key is released", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      await store.release(k, u);
      expect(await store.begin(k, u, "h1", HOUR)).toEqual({ kind: "claimed" });
    });

    it("does not release a completed key", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", HOUR);
      await store.complete(k, u, 201, { ok: true });
      await store.release(k, u);
      expect(await store.begin(k, u, "h1", HOUR)).toMatchObject({ kind: "replay", status: 201 });
    });

    it("takes over an expired key", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      await store.begin(k, u, "h1", 1);
      await store.complete(k, u, 201, { old: true });
      await sleep(30);
      expect(await store.begin(k, u, "h2", HOUR)).toEqual({ kind: "claimed" });
    });

    it("lets only one of many concurrent first requests claim the key", async () => {
      const store = factory();
      const [k, u] = [key(), user()];
      const results = await Promise.all(
        Array.from({ length: 10 }, () => store.begin(k, u, "h1", HOUR)),
      );
      expect(results.filter((r) => r.kind === "claimed")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "in_progress")).toHaveLength(9);
    });

    it("purges expired keys and keeps live ones", async () => {
      const store = factory();
      const [expired, live, u] = [key(), key(), user()];
      await store.begin(expired, u, "h1", 1);
      await store.begin(live, u, "h1", HOUR);
      await sleep(30);

      expect(await store.purgeExpired()).toBeGreaterThanOrEqual(1);

      expect(await store.begin(live, u, "h1", HOUR)).toEqual({ kind: "in_progress" });
      expect(await store.begin(expired, u, "h1", HOUR)).toEqual({ kind: "claimed" });
    });
  });
}