import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import {
  connectionCloseWhenShuttingDown,
  errorHandler,
  healthRouter,
  notFoundHandler,
  type ReadinessCheck,
} from "../../apps/api/src/http.js";
import { idempotency, InMemoryIdempotencyStore } from "../../shared/http/index.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

const json = { "content-type": "application/json" };

describe("health endpoints", () => {
  async function setup(opts: {
    checks?: ReadinessCheck[];
    shuttingDown?: boolean;
    timeoutMs?: number;
  }) {
    const app = express();
    app.use(
      healthRouter({
        checks: opts.checks ?? [],
        isShuttingDown: () => opts.shuttingDown ?? false,
        timeoutMs: opts.timeoutMs,
      }),
    );
    return serve(app);
  }

  it("liveness answers 200 and ignores dependencies", async () => {
    const url = await setup({
      checks: [{ name: "database", check: () => Promise.reject(new Error("down")) }],
    });
    const r = await fetch(`${url}/health`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ok" });
  });

  it("readiness is 200 when every check passes", async () => {
    const url = await setup({
      checks: [{ name: "database", check: async () => undefined }],
    });
    const r = await fetch(`${url}/health/ready`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "ready", checks: { database: "ok" } });
  });

  it("readiness is 200 when there is nothing to check", async () => {
    const url = await setup({});
    expect((await fetch(`${url}/health/ready`)).status).toBe(200);
  });

  it("readiness is 503 when a check fails, without leaking the reason", async () => {
    const url = await setup({
      checks: [
        { name: "database", check: () => Promise.reject(new Error("password for wms rejected")) },
      ],
    });
    const r = await fetch(`${url}/health/ready`);
    const text = await r.text();
    expect(r.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: "unavailable", checks: { database: "failed" } });
    expect(text).not.toContain("password");
  });

  it("readiness is 503 when a check hangs", async () => {
    const url = await setup({
      checks: [{ name: "database", check: () => new Promise(() => undefined) }],
      timeoutMs: 50,
    });
    const r = await fetch(`${url}/health/ready`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: "unavailable", checks: { database: "failed" } });
  });

  it("readiness is 503 while shutting down, and does not touch the dependencies", async () => {
    let calls = 0;
    const url = await setup({
      shuttingDown: true,
      checks: [{ name: "database", check: async () => void (calls += 1) }],
    });
    const r = await fetch(`${url}/health/ready`);
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ status: "shutting_down" });
    expect(calls).toBe(0);
  });
});

describe("connectionCloseWhenShuttingDown", () => {
  const run = (shuttingDown: boolean) => {
    const headers: Record<string, string> = {};
    let nextCalled = false;
    connectionCloseWhenShuttingDown(() => shuttingDown)(
      {} as never,
      { setHeader: (k: string, v: string) => void (headers[k] = v) } as never,
      () => {
        nextCalled = true;
      },
    );
    return { headers, nextCalled };
  };

  it("asks clients to close the connection while shutting down", () => {
    expect(run(true)).toEqual({ headers: { Connection: "close" }, nextCalled: true });
  });

  it("does nothing otherwise", () => {
    expect(run(false)).toEqual({ headers: {}, nextCalled: true });
  });
});

describe("error handling", () => {
  async function setup() {
    const calls = { flaky: 0 };
    const app = express();
    app.use(express.json());
    app.use(idempotency(new InMemoryIdempotencyStore()));
    app.post("/boom", async () => {
      throw new Error("db password is hunter2");
    });
    app.post("/flaky", async (_req, res) => {
      calls.flaky += 1;
      if (calls.flaky === 1) throw new Error("connection lost");
      res.status(201).json({ calls: calls.flaky });
    });
    app.post("/echo", (req, res) => {
      res.status(201).json(req.body);
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    return { url: await serve(app), calls };
  }

  it("answers an error thrown in an async route with a generic JSON 500", async () => {
    const { url } = await setup();
    const r = await fetch(`${url}/boom`, { method: "POST", headers: json, body: "{}" });
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "internal server error" });
    expect(text).not.toContain("hunter2");
  });

  it("answers malformed JSON with a 400", async () => {
    const { url } = await setup();
    const r = await fetch(`${url}/echo`, { method: "POST", headers: json, body: "{not json" });
    expect(r.status).toBe(400);
    expect(typeof ((await r.json()) as { error: unknown }).error).toBe("string");
  });

  it("answers unknown routes with a JSON 404", async () => {
    const { url } = await setup();
    const r = await fetch(`${url}/nope`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not found" });
  });

  it("releases an Idempotency-Key when a route crashes, so the retry runs", async () => {
    const { url, calls } = await setup();
    const key = randomUUID();
    const post = () =>
      fetch(`${url}/flaky`, {
        method: "POST",
        headers: { ...json, "idempotency-key": key },
        body: "{}",
      });

    const first = await post();
    const second = await post();

    expect(first.status).toBe(500);
    expect(second.status).toBe(201);
    expect(calls.flaky).toBe(2);
  });
});