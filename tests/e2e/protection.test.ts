import express, { Router } from "express";
import { afterAll, describe, expect, it } from "vitest";
import { accessRules } from "../../apps/api/src/access-rules.js";
import { errorHandler } from "../../apps/api/src/http.js";
import { principalOf, protect } from "../../apps/api/src/security.js";
import { createIdentityModule, ScryptPasswordHasher } from "../../modules/identity/index.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

const WH_A = "11111111-1111-4111-8111-111111111111";
const WH_B = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "a long enough passphrase";

/** The real rules and the real identity module, with stand-in handlers where modules would be. */
async function start() {
  const identity = createIdentityModule({
    hasher: new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 }),
    warehouses: { exists: async () => true },
  });
  const hits = { count: 0 };
  const handler: express.RequestHandler = (req, res) => {
    hits.count += 1;
    res.json({ ok: true, as: principalOf(req)?.username });
  };
  const inventory = Router();
  inventory.get("/warehouses/:warehouseId/skus/:sku/locations/:locationId/balance", handler);
  inventory.post("/warehouses/:warehouseId/adjustments", handler);

  const app = express();
  app.use(protect({ rules: accessRules, authenticate: identity.authenticate }));
  app.use(express.json());
  app.use("/inventory", inventory);
  app.use("/identity", identity.router);
  app.use(errorHandler);
  return { base: await serve(app), identity, hits };
}
type World = Awaited<ReturnType<typeof start>>;

/** Creates a user with the given roles and warehouse grants, and signs them in. */
async function member(w: World, username: string, roles: string[], warehouses: string[] = []) {
  const created = await w.identity.users.create({
    username,
    displayName: username,
    password: PASSWORD,
  });
  if (!created.ok) throw created.error;
  for (const role of roles) await w.identity.access.assignRole(created.value.id, role);
  for (const wh of warehouses) await w.identity.access.grantWarehouse(created.value.id, wh);
  const login = await w.identity.auth.login({ username, password: PASSWORD });
  if (!login.ok) throw login.error;
  return { id: created.value.id, token: login.value.token };
}

async function call(w: World, method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${w.base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : null,
  };
}

const balance = (wh: string) => `/inventory/warehouses/${wh}/skus/SKU-1/locations/A-01/balance`;
const adjust = (wh: string) => `/inventory/warehouses/${wh}/adjustments`;
const adjustment = { sku: "SKU-1", locationId: "A-01", delta: 1, reason: "test" };

describe("route protection", () => {
  it("refuses a request without a valid session with 401", async () => {
    const w = await start();
    const none = await call(w, "GET", balance(WH_A));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe("Bearer");
    expect(none.body).toEqual({ error: "authentication required" });
    expect((await call(w, "GET", balance(WH_A), "garbage")).status).toBe(401);
    expect((await call(w, "GET", balance(WH_A), "wms_" + "A".repeat(43))).status).toBe(401);
    const basic = await fetch(`${w.base}${balance(WH_A)}`, {
      headers: { authorization: "Basic YTpi" },
    });
    expect(basic.status).toBe(401);
    expect(w.hits.count).toBe(0);
  });

  it("lets login through without a token, and leaves the answer to the login route", async () => {
    const w = await start();
    await member(w, "jane.doe", []);
    const bad = await call(w, "POST", "/identity/login", undefined, {
      username: "jane.doe",
      password: "wrong password",
    });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: "invalid username or password" }); // from the route, not from protect
    const good = await call(w, "POST", "/identity/login", undefined, {
      username: "jane.doe",
      password: PASSWORD,
    });
    expect(good.status).toBe(200);
  });

  it("lets a user act only where they hold the permission and the warehouse", async () => {
    const w = await start();
    const picker = await member(w, "pat.picker", ["PICKER"], [WH_A]);

    const ok = await call(w, "GET", balance(WH_A), picker.token);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, as: "pat.picker" });
    expect((await call(w, "GET", balance(WH_B), picker.token)).status).toBe(403); // other warehouse
    expect((await call(w, "POST", adjust(WH_A), picker.token, adjustment)).status).toBe(403); // no inventory.adjust
    expect((await call(w, "GET", balance(WH_A.toUpperCase()), picker.token)).status).toBe(200); // case does not matter
  });

  it("does not reach the handler when it refuses", async () => {
    const w = await start();
    const picker = await member(w, "pat.picker", ["PICKER"], [WH_A]);
    await call(w, "POST", adjust(WH_A), picker.token, adjustment);
    await call(w, "GET", balance(WH_B), picker.token);
    expect(w.hits.count).toBe(0);
  });

  it("gives an inventory controller their warehouse but not user administration", async () => {
    const w = await start();
    const clerk = await member(w, "ivy.controller", ["INVENTORY_CONTROLLER"], [WH_A]);
    expect((await call(w, "POST", adjust(WH_A), clerk.token, adjustment)).status).toBe(200);
    expect((await call(w, "POST", adjust(WH_B), clerk.token, adjustment)).status).toBe(403);
    expect((await call(w, "GET", "/identity/users", clerk.token)).status).toBe(403);
  });

  it("lets a warehouse manager look at users but not change them", async () => {
    const w = await start();
    const manager = await member(w, "max.manager", ["WAREHOUSE_MANAGER"], [WH_A]);
    expect((await call(w, "GET", "/identity/users", manager.token)).status).toBe(200);
    const newUser = { username: "new.person", displayName: "N", password: PASSWORD };
    expect((await call(w, "POST", "/identity/users", manager.token, newUser)).status).toBe(403);
    expect(
      (await call(w, "PUT", `/identity/users/${manager.id}/roles/ADMIN`, manager.token)).status,
    ).toBe(403);
  });

  it("lets an administrator act in every warehouse and manage users", async () => {
    const w = await start();
    const admin = await member(w, "ada.admin", ["ADMIN"]);
    expect((await call(w, "POST", adjust(WH_B), admin.token, adjustment)).status).toBe(200);
    expect((await call(w, "GET", "/identity/users", admin.token)).status).toBe(200);
    const created = await call(w, "POST", "/identity/users", admin.token, {
      username: "new.person",
      displayName: "N",
      password: PASSWORD,
    });
    expect(created.status).toBe(201);
  });

  it("lets any signed-in user see and change their own account, and no one else's", async () => {
    const w = await start();
    const nobody = await member(w, "no.roles", []);
    expect((await call(w, "GET", "/identity/me", nobody.token)).status).toBe(200);
    expect((await call(w, "GET", `/identity/users/${nobody.id}`, nobody.token)).status).toBe(403);
    expect((await call(w, "GET", `/identity/users/${nobody.id}/access`, nobody.token)).status).toBe(
      403,
    );
  });

  it("answers 404 for paths no rule covers, and never hands them to a handler", async () => {
    const w = await start();
    const admin = await member(w, "ada.admin", ["ADMIN"]);
    const missing = await call(w, "GET", "/inventory/warehouses/x/anything", admin.token);
    expect(missing.status).toBe(404);
    expect((await call(w, "DELETE", balance(WH_A), admin.token)).status).toBe(404); // right path, no rule for DELETE
    expect((await call(w, "GET", "/nowhere", admin.token)).status).toBe(404);
    expect((await call(w, "GET", "/nowhere")).status).toBe(401); // and no hint of what exists
    expect(w.hits.count).toBe(0);
  });

  it("stops honouring a session the moment the user is disabled or signs out", async () => {
    const w = await start();
    await member(w, "ada.admin", ["ADMIN"]);
    const picker = await member(w, "pat.picker", ["PICKER"], [WH_A]);
    const other = await member(w, "sam.picker", ["PICKER"], [WH_A]);
    expect((await call(w, "GET", balance(WH_A), picker.token)).status).toBe(200);

    const disabled = await w.identity.users.update(picker.id, { version: 1, status: "DISABLED" });
    expect(disabled.ok).toBe(true);
    expect((await call(w, "GET", balance(WH_A), picker.token)).status).toBe(401);

    expect((await call(w, "POST", "/identity/logout", other.token)).status).toBe(204);
    expect((await call(w, "GET", balance(WH_A), other.token)).status).toBe(401);
  });

  it("takes away access as soon as a role is removed", async () => {
    const w = await start();
    const picker = await member(w, "pat.picker", ["PICKER"], [WH_A]);
    expect((await call(w, "GET", balance(WH_A), picker.token)).status).toBe(200);
    await w.identity.access.removeRole(picker.id, "PICKER");
    expect((await call(w, "GET", balance(WH_A), picker.token)).status).toBe(403);
  });
});
