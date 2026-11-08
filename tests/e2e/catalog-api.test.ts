import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../apps/api/src/http.js";
import { createCatalogModule } from "../../modules/catalog/index.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

const uniq = () => randomUUID().slice(0, 8);

/** The parts of a response body these tests read. */
interface ApiBody {
  sku: string;
  code: string;
  error: string;
  version: number;
  items: { sku: string; code: string; uom: string }[];
  units: { uom: string; qtyInBase: number }[];
  nextAfter: string | null;
  [key: string]: unknown;
}

async function setup() {
  const app = express();
  app.use(express.json());
  app.use("/catalog", createCatalogModule().router);
  app.use(errorHandler);
  const url = await serve(app);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}/catalog${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as ApiBody };
  };
  return { call };
}

describe("catalog API", () => {
  it("creates an item with its base unit and reads it back", async () => {
    const { call } = await setup();
    const created = await call("POST", "/items", {
      sku: "WIDGET-1",
      description: "Widget",
      baseUom: "EA",
      units: [{ uom: "CS", qtyInBase: 12, weight: 5 }],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      sku: "WIDGET-1",
      baseUom: "EA",
      status: "ACTIVE",
      version: 1,
    });
    expect(created.body.units.map((u) => [u.uom, u.qtyInBase])).toEqual([
      ["CS", 12],
      ["EA", 1],
    ]);

    const read = await call("GET", "/items/WIDGET-1");
    expect(read.status).toBe(200);
    expect(read.body.sku).toBe("WIDGET-1");
    expect((await call("GET", "/items/NOPE")).status).toBe(404);
  });

  it("validates the request: 400 for bad input, 409 for duplicates, 422 for broken rules", async () => {
    const { call } = await setup();
    expect(
      (await call("POST", "/items", { sku: "bad sku", description: "x", baseUom: "EA" })).status,
    ).toBe(400);
    expect((await call("POST", "/items", { sku: "OK", description: "x" })).status).toBe(400);
    expect(
      (await call("POST", "/items", { sku: "OK", description: "x", baseUom: "EA", extra: 1 }))
        .status,
    ).toBe(400);

    await call("POST", "/items", { sku: "DUP-1", description: "First", baseUom: "EA" });
    expect(
      (await call("POST", "/items", { sku: "dup-1", description: "Second", baseUom: "EA" })).status,
    ).toBe(409);
    expect(
      (await call("POST", "/items", { sku: "X-1", description: "x", baseUom: "NOPE" })).status,
    ).toBe(422);
    expect(
      (
        await call("POST", "/items", {
          sku: "X-2",
          description: "x",
          baseUom: "EA",
          shelfLifeDays: 30,
        })
      ).status,
    ).toBe(422);
  });

  it("updates with a version, and refuses a stale update, an empty one, and the fixed fields", async () => {
    const { call } = await setup();
    await call("POST", "/items", { sku: "U-1", description: "Old", baseUom: "EA" });

    const updated = await call("PATCH", "/items/U-1", {
      version: 1,
      description: "New",
      status: "INACTIVE",
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ description: "New", status: "INACTIVE", version: 2 });

    expect((await call("PATCH", "/items/U-1", { version: 1, description: "Late" })).status).toBe(
      409,
    );
    expect((await call("PATCH", "/items/U-1", { version: 2 })).status).toBe(400);
    for (const forbidden of [
      { sku: "U-2" },
      { baseUom: "CS" },
      { isLotTracked: true },
      { hasExpiry: true },
    ]) {
      expect((await call("PATCH", "/items/U-1", { version: 2, ...forbidden })).status).toBe(400);
    }
  });

  it("adds, lists and updates units", async () => {
    const { call } = await setup();
    await call("POST", "/items", { sku: "P-1", description: "Packed", baseUom: "EA" });

    const added = await call("POST", "/items/P-1/units", { uom: "CS", qtyInBase: 12 });
    expect(added.status).toBe(201);
    expect((await call("POST", "/items/P-1/units", { uom: "CS", qtyInBase: 6 })).status).toBe(409);
    expect((await call("POST", "/items/P-1/units", { uom: "PL" })).status).toBe(400);

    const listed = await call("GET", "/items/P-1/units");
    expect(listed.body.items.map((u) => u.uom)).toEqual(["CS", "EA"]);

    const updated = await call("PATCH", "/items/P-1/units/CS", { version: 1, qtyInBase: 24 });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ qtyInBase: 24, version: 2 });
    expect((await call("PATCH", "/items/P-1/units/EA", { version: 1, qtyInBase: 2 })).status).toBe(
      422,
    );
  });

  it("lists items with filters and pages", async () => {
    const { call } = await setup();
    const prefix = `L${uniq()}`;
    await call("POST", "/categories", { code: "LISTCAT", name: "List" });
    for (const n of ["1", "2", "3"]) {
      await call("POST", "/items", {
        sku: `${prefix}-${n}`,
        description: "x",
        baseUom: "EA",
        category: "LISTCAT",
      });
    }

    const page = await call("GET", "/items?category=LISTCAT&limit=2");
    expect(page.status).toBe(200);
    expect(page.body.items.map((i) => i.sku)).toEqual([`${prefix}-1`, `${prefix}-2`]);
    expect(page.body.nextAfter).toBe(`${prefix}-2`);

    const rest = await call("GET", `/items?category=LISTCAT&limit=2&after=${prefix}-2`);
    expect(rest.body.items.map((i) => i.sku)).toEqual([`${prefix}-3`]);
    expect(rest.body.nextAfter).toBeNull();

    expect((await call("GET", "/items?limit=0")).status).toBe(400);
    expect((await call("GET", "/items?category=NOPE")).status).toBe(422);
  });

  it("manages categories and units of measure", async () => {
    const { call } = await setup();
    expect((await call("POST", "/categories", { code: "ROOT", name: "Root" })).status).toBe(201);
    const child = await call("POST", "/categories", { code: "KID", name: "Child", parent: "ROOT" });
    expect(child.status).toBe(201);
    expect(child.body.parent).toBe("ROOT");
    expect((await call("POST", "/categories", { code: "root", name: "Again" })).status).toBe(409);
    expect((await call("PATCH", "/categories/KID", { version: 1, name: "Renamed" })).status).toBe(
      200,
    );
    expect((await call("PATCH", "/categories/KID", { version: 1, name: "Late" })).status).toBe(409);

    const uoms = await call("GET", "/uoms");
    expect(uoms.body.items.map((u) => u.code)).toEqual(expect.arrayContaining(["EA", "CS", "PL"]));
    expect((await call("POST", "/uoms", { code: "KG", name: "Kilogram" })).status).toBe(201);
    expect((await call("POST", "/uoms", { code: "kg", name: "Again" })).status).toBe(409);
  });
});
