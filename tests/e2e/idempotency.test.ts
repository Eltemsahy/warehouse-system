import { randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  idempotency,
  InMemoryIdempotencyStore,
  PgIdempotencyStore,
  type IdempotencyOptions,
  type IdempotencyStore,
} from "../../shared/http/index.js";
import {
  createInventoryModule,
  InMemoryLedger,
  PgStockLedger,
  type StockLedger,
} from "../../modules/inventory/index.js";

const postgresEnabled = process.env.LEDGER_DRIVER === "postgres";
const pool = postgresEnabled
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
  : undefined;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
  await pool?.end();
});

/** Starts the app on a random port and returns its base URL. */
async function serve(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = { "content-type": "application/json" };

/**
 * Generic middleware behaviour, with a tiny route that counts how often it really ran.
 */
describe("idempotency middleware", () => {
  async function setup(options?: IdempotencyOptions) {
    const calls = { count: 0 };
    let respond: (n: number) => { status: number; body: unknown } = (n) => ({
      status: 201,
      body: { n },
    });
    const app = express();
    app.use(express.json());
    app.use(idempotency(new InMemoryIdempotencyStore(), options));
    app.post("/things", async (_req, res) => {
      calls.count += 1;
      const { status, body } = respond(calls.count);
      return res.status(status).json(body);
    });
    app.get("/things", (_req, res) => res.json({ ok: true }));
    const url = await serve(app);
    const post = (key?: string, body: unknown = { a: 1 }) =>
      fetch(`${url}/things`, {
        method: "POST",
        headers: { ...json, ...(key ? { "idempotency-key": key } : {}) },
        body: JSON.stringify(body),
      });
    return { app, url, calls, post, setRespond: (fn: typeof respond) => (respond = fn) };
  }

  it("replays the original response and runs the handler once", async () => {
    const { calls, post } = await setup();
    const key = randomUUID();

    const first = await post(key);
    const second = await post(key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    expect(calls.count).toBe(1);
  });

  it("treats a body with reordered keys as the same request", async () => {
    const { calls, post } = await setup();
    const key = randomUUID();
    await post(key, { a: 1, b: { x: 1, y: 2 } });
    const second = await post(key, { b: { y: 2, x: 1 }, a: 1 });
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(calls.count).toBe(1);
  });

  it("runs normally when no key is sent", async () => {
    const { calls, post } = await setup();
    await post();
    await post();
    expect(calls.count).toBe(2);
  });

  it("rejects the same key with a different request (422)", async () => {
    const { calls, post } = await setup();
    const key = randomUUID();
    await post(key, { a: 1 });
    const second = await post(key, { a: 2 });
    expect(second.status).toBe(422);
    expect(calls.count).toBe(1);
  });

  it("replays business-rule rejections (4xx) too", async () => {
    const { calls, post, setRespond } = await setup();
    setRespond(() => ({ status: 422, body: { error: "insufficient stock" } }));
    const key = randomUUID();
    const first = await post(key);
    const second = await post(key);
    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(await second.json()).toEqual({ error: "insufficient stock" });
    expect(calls.count).toBe(1);
  });

  it("does not keep 5xx responses, so the client can retry", async () => {
    const { calls, post, setRespond } = await setup();
    setRespond((n) =>
      n === 1 ? { status: 500, body: { error: "boom" } } : { status: 201, body: { n } },
    );
    const key = randomUUID();
    const first = await post(key);
    const second = await post(key);
    expect(first.status).toBe(500);
    expect(second.status).toBe(201);
    expect(calls.count).toBe(2);
  });

  it("answers 409 while the first request is still running, then replays", async () => {
    const calls = { count: 0 };
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (open = resolve));
    let entered: () => void = () => undefined;
    const handlerEntered = new Promise<void>((resolve) => (entered = resolve));

    const app = express();
    app.use(express.json());
    app.use(idempotency(new InMemoryIdempotencyStore()));
    app.post("/slow", async (_req, res) => {
      calls.count += 1;
      entered();
      await gate;
      return res.status(201).json({ done: true });
    });
    const url = await serve(app);
    const post = (key: string) =>
      fetch(`${url}/slow`, {
        method: "POST",
        headers: { ...json, "idempotency-key": key },
        body: "{}",
      });
    const key = randomUUID();

    const first = post(key);
    await handlerEntered;
    const duplicate = await post(key);
    expect(duplicate.status).toBe(409);

    open();
    expect((await first).status).toBe(201);
    const replay = await post(key);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(calls.count).toBe(1);
  });

  it("ignores the header on GET requests", async () => {
    const { url } = await setup();
    const r = await fetch(`${url}/things`, { headers: { "idempotency-key": "x" } });
    expect(r.status).toBe(200);
    expect(r.headers.get("idempotent-replayed")).toBeNull();
  });

  it("returns 400 for a missing key when required, and for an invalid key", async () => {
    const { post } = await setup({ required: true });
    expect((await post()).status).toBe(400);
    expect((await post("has spaces")).status).toBe(400);
    expect((await post("x".repeat(256))).status).toBe(400);
    expect((await post(randomUUID())).status).toBe(201);
  });
});

/**
 * The plan's exit criterion: replaying a request returns the original response and no
 * second movement is written.
 */
function inventoryIdempotency(
  name: string,
  make: () => { ledger: StockLedger; store: IdempotencyStore },
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`inventory API idempotency: ${name}`, () => {
    async function setup() {
      const { ledger, store } = make();
      const app = express();
      app.use(express.json());
      app.use(idempotency(store));
      app.use("/inventory", createInventoryModule({ ledger }).router);
      const url = await serve(app);
      const sku = `SKU-${randomUUID()}`;
      const adjust = (delta: number, key?: string) =>
        fetch(`${url}/inventory/adjustments`, {
          method: "POST",
          headers: { ...json, ...(key ? { "idempotency-key": key } : {}) },
          body: JSON.stringify({ sku, locationId: "A-01", delta, reason: "test" }),
        });
      const balance = async () =>
        (
          (await (await fetch(`${url}/inventory/${sku}/locations/A-01/balance`)).json()) as {
            balance: number;
          }
        ).balance;
      return { adjust, balance };
    }

    it("replays the response and writes no second movement", async () => {
      const { adjust, balance } = await setup();
      const key = randomUUID();

      const first = await adjust(10, key);
      const second = await adjust(10, key);

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(await second.json()).toEqual(await first.json()); // same movement id
      expect(await balance()).toBe(10); // not 20
    });

    it("applies a repeated request without a key twice", async () => {
      const { adjust, balance } = await setup();
      await adjust(10);
      await adjust(10);
      expect(await balance()).toBe(20);
    });

    it("replays a rejected adjustment", async () => {
      const { adjust, balance } = await setup();
      const key = randomUUID();
      const first = await adjust(-1, key);
      const second = await adjust(-1, key);
      expect(first.status).toBe(422);
      expect(second.status).toBe(422);
      expect(await balance()).toBe(0);
    });
  });
}

inventoryIdempotency("in-memory", () => ({
  ledger: new InMemoryLedger(),
  store: new InMemoryIdempotencyStore(),
}));

inventoryIdempotency(
  "postgres",
  () => {
    if (!pool) throw new Error("Postgres pool not initialised");
    return { ledger: new PgStockLedger(pool), store: new PgIdempotencyStore(pool) };
  },
  { skip: !postgresEnabled },
);
