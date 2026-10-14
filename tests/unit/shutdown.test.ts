import { describe, expect, it } from "vitest";
import { createShutdown, type HttpServerLike } from "../../apps/api/src/lifecycle.js";

const silent = { info: () => undefined, error: () => undefined };

/** A fake server that records the order of calls. */
function fakeServer(events: string[], opts: { neverCloses?: boolean } = {}): HttpServerLike {
  return {
    close(callback) {
      events.push("server.close");
      if (!opts.neverCloses) callback?.();
    },
    closeIdleConnections() {
      events.push("server.closeIdleConnections");
    },
  };
}

describe("createShutdown", () => {
  it("flips readiness first, drains the server, then runs the steps in order", async () => {
    const events: string[] = [];
    const shutdown = createShutdown({
      server: fakeServer(events),
      onStart: () => {
        events.push("onStart");
      },
      steps: [
        { name: "relay", run: async () => void events.push("relay") },
        { name: "pool", run: async () => void events.push("pool") },
      ],
      log: silent,
    });

    expect(await shutdown("SIGTERM")).toBe(0);
    expect(events).toEqual([
      "onStart",
      "server.close",
      "server.closeIdleConnections",
      "relay",
      "pool",
    ]);
  });

  it("keeps going when a step fails, and reports failure", async () => {
    const events: string[] = [];
    const shutdown = createShutdown({
      server: fakeServer(events),
      steps: [
        {
          name: "relay",
          run: async () => {
            throw new Error("stuck");
          },
        },
        { name: "pool", run: async () => void events.push("pool") },
      ],
      log: silent,
    });

    expect(await shutdown("SIGINT")).toBe(1);
    expect(events).toContain("pool");
  });

  it("gives up after the timeout when the server never drains", async () => {
    const events: string[] = [];
    const shutdown = createShutdown({
      server: fakeServer(events, { neverCloses: true }),
      steps: [],
      timeoutMs: 30,
      log: silent,
    });

    expect(await shutdown("SIGTERM")).toBe(1);
  });

  it("runs once even if called twice", async () => {
    let runs = 0;
    const shutdown = createShutdown({
      server: fakeServer([]),
      steps: [{ name: "count", run: async () => void (runs += 1) }],
      log: silent,
    });

    const [a, b] = await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

    expect([a, b]).toEqual([0, 0]);
    expect(runs).toBe(1);
  });
});