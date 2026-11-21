import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../apps/api/src/http.js";
import { createIdentityModule, ScryptPasswordHasher } from "../../modules/identity/index.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

type ApiBody = Record<string, unknown> & { id?: string; items?: unknown[] };

async function start() {
  const m = createIdentityModule({ hasher: new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 }) });
  const app = express();
  app.use(express.json());
  app.use("/identity", m.router);
  app.use(errorHandler);
  return serve(app);
}

async function call(base: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/identity${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as ApiBody) : null };
}

const jane = {
  username: "jane.doe",
  displayName: "Jane Doe",
  email: "jane@example.test",
  password: "a long enough passphrase",
};

describe("identity API", () => {
  it("creates, reads, lists and updates a user, and never shows the password", async () => {
    const base = await start();
    const created = await call(base, "POST", "/users", jane);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      username: "jane.doe",
      status: "ACTIVE",
      locale: "en",
      version: 1,
    });
    expect(JSON.stringify(created.body)).not.toMatch(/password|scrypt/i);

    const id = created.body?.id as string;
    expect((await call(base, "GET", `/users/${id}`)).body).toMatchObject({ username: "jane.doe" });

    const list = await call(base, "GET", "/users?limit=10");
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ nextAfter: null });
    expect(list.body?.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toMatch(/password|scrypt/i);

    const patched = await call(base, "PATCH", `/users/${id}`, {
      version: 1,
      displayName: "J. Doe",
      status: "DISABLED",
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ displayName: "J. Doe", status: "DISABLED", version: 2 });
    expect((await call(base, "GET", "/users?status=ACTIVE")).body?.items).toHaveLength(0);
  });

  it("resets a password with 204 and applies the policy with 422", async () => {
    const base = await start();
    const id = (await call(base, "POST", "/users", jane)).body?.id as string;
    expect((await call(base, "PUT", `/users/${id}/password`, { password: "short" })).status).toBe(
      422,
    );
    expect(
      (await call(base, "PUT", `/users/${id}/password`, { password: "a brand new passphrase" }))
        .status,
    ).toBe(204);
    expect(
      (
        await call(base, "PUT", `/users/00000000-0000-4000-8000-000000000000/password`, {
          password: "a brand new passphrase",
        })
      ).status,
    ).toBe(404);
  });

  it("validates the request: 400, 404, 409 and 422", async () => {
    const base = await start();
    const id = (await call(base, "POST", "/users", jane)).body?.id as string;

    expect((await call(base, "POST", "/users", { ...jane, username: "x" })).status).toBe(400);
    expect((await call(base, "POST", "/users", { ...jane, extra: 1 })).status).toBe(400);
    expect(
      (await call(base, "POST", "/users", { username: "no.password", displayName: "N" })).status,
    ).toBe(400);
    expect(
      (
        await call(base, "POST", "/users", {
          ...jane,
          username: "weak.pw",
          email: null,
          password: "short",
        })
      ).status,
    ).toBe(422);
    expect(
      (await call(base, "POST", "/users", { ...jane, username: "JANE.DOE", email: null })).status,
    ).toBe(409);

    expect((await call(base, "GET", "/users/not-a-uuid")).status).toBe(400);
    expect((await call(base, "GET", "/users/00000000-0000-4000-8000-000000000000")).status).toBe(
      404,
    );
    expect((await call(base, "GET", "/users?limit=0")).status).toBe(400);
    expect((await call(base, "GET", "/users?status=LOCKED")).status).toBe(400);

    expect((await call(base, "PATCH", `/users/${id}`, { displayName: "No version" })).status).toBe(
      400,
    );
    expect((await call(base, "PATCH", `/users/${id}`, { version: 1 })).status).toBe(400);
    expect(
      (await call(base, "PATCH", `/users/${id}`, { version: 1, username: "renamed" })).status,
    ).toBe(400);
    expect(
      (await call(base, "PATCH", `/users/${id}`, { version: 1, displayName: "A" })).status,
    ).toBe(200);
    expect(
      (await call(base, "PATCH", `/users/${id}`, { version: 1, displayName: "B" })).status,
    ).toBe(409);
  });
});
