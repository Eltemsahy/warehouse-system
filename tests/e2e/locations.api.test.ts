import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../apps/api/src/http.js";
import { createLocationsModule } from "../../modules/locations/index.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

const uniq = () => randomUUID().slice(0, 8);

/** The parts of a response body these tests read. */
interface ApiBody {
  id: string;
  code: string;
  error: string;
  items: { code: string }[];
  nextAfter: string | null;
  [key: string]: unknown;
}

async function setup() {
  const app = express();
  app.use(express.json());
  app.use("/locations", createLocationsModule().router);
  app.use(errorHandler);
  const url = await serve(app);

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}/locations${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as ApiBody };
  };
  const newWarehouse = async () => {
    const r = await call("POST", "/warehouses", { code: `WH-${uniq()}`, name: "Main" });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  return { call, newWarehouse };
}

describe("locations API", () => {
  it("creates and reads a warehouse", async () => {
    const { call } = await setup();
    const created = await call("POST", "/warehouses", {
      code: "CAI-1",
      name: "Cairo DC",
      timezone: "Africa/Cairo",
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: "CAI-1",
      name: "Cairo DC",
      timezone: "Africa/Cairo",
      status: "ACTIVE",
      version: 1,
    });

    const read = await call("GET", `/warehouses/${created.body.id}`);
    expect(read.status).toBe(200);
    expect(read.body.code).toBe("CAI-1");

    const list = await call("GET", "/warehouses");
    expect(list.status).toBe(200);
    expect(list.body.items.map((w: { code: string }) => w.code)).toContain("CAI-1");
  });

  it("validates the request: 400 for bad input, 404 for unknown, 409 for duplicates", async () => {
    const { call } = await setup();
    expect((await call("POST", "/warehouses", { code: "has space", name: "x" })).status).toBe(400);
    expect((await call("POST", "/warehouses", { name: "no code" })).status).toBe(400);
    expect((await call("POST", "/warehouses", { code: "OK", name: "x", extra: 1 })).status).toBe(
      400,
    );
    expect((await call("GET", "/warehouses/not-a-uuid")).status).toBe(400);
    expect((await call("GET", `/warehouses/${randomUUID()}`)).status).toBe(404);

    await call("POST", "/warehouses", { code: "DUP", name: "First" });
    const dup = await call("POST", "/warehouses", { code: "dup", name: "Second" });
    expect(dup.status).toBe(409);
    expect(typeof dup.body.error).toBe("string");
  });

  it("answers 422 for a rule violation, such as an unknown time zone", async () => {
    const { call } = await setup();
    const r = await call("POST", "/warehouses", {
      code: "MARS",
      name: "Mars",
      timezone: "Mars/Base",
    });
    expect(r.status).toBe(422);
  });

  it("creates a zone and a location, and reads the location by code", async () => {
    const { call, newWarehouse } = await setup();
    const w = await newWarehouse();
    const zone = await call("POST", `/warehouses/${w}/zones`, { code: "PICK-1", type: "PICKING" });
    expect(zone.status).toBe(201);

    const created = await call("POST", `/warehouses/${w}/locations`, {
      code: "A-01-02",
      zoneId: zone.body.id,
      type: "BIN",
      aisle: "A",
      capacity: { maxUnits: 50 },
      storageClasses: ["AMBIENT"],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      warehouseId: w,
      code: "A-01-02",
      type: "BIN",
      isPickable: true,
      status: "AVAILABLE",
      isActive: true,
      storageClasses: ["AMBIENT"],
      version: 1,
    });
    expect(created.body.capacity).toMatchObject({ maxUnits: 50 });

    const read = await call("GET", `/warehouses/${w}/locations/A-01-02`);
    expect(read.status).toBe(200);
    expect(read.body.id).toBe(created.body.id);
    expect((await call("GET", `/warehouses/${w}/locations/NOPE`)).status).toBe(404);
  });

  it("lets two warehouses both have an A-01 and refuses a duplicate in one", async () => {
    const { call, newWarehouse } = await setup();
    const [w1, w2] = [await newWarehouse(), await newWarehouse()];
    const body = { code: "A-01", type: "BIN" };
    expect((await call("POST", `/warehouses/${w1}/locations`, body)).status).toBe(201);
    expect((await call("POST", `/warehouses/${w2}/locations`, body)).status).toBe(201);
    expect(
      (await call("POST", `/warehouses/${w1}/locations`, { ...body, code: "a-01" })).status,
    ).toBe(409);
  });

  it("updates with a version, and refuses a stale or empty update", async () => {
    const { call, newWarehouse } = await setup();
    const w = await newWarehouse();
    await call("POST", `/warehouses/${w}/locations`, { code: "A-01", type: "BIN" });

    const updated = await call("PATCH", `/warehouses/${w}/locations/A-01`, {
      version: 1,
      status: "BLOCKED",
      aisle: "A",
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: "BLOCKED", aisle: "A", version: 2 });

    const stale = await call("PATCH", `/warehouses/${w}/locations/A-01`, {
      version: 1,
      aisle: "B",
    });
    expect(stale.status).toBe(409);

    const empty = await call("PATCH", `/warehouses/${w}/locations/A-01`, { version: 2 });
    expect(empty.status).toBe(400);
  });

  it("never lets a code or a warehouse be changed through the API", async () => {
    const { call, newWarehouse } = await setup();
    const [w, other] = [await newWarehouse(), await newWarehouse()];
    await call("POST", `/warehouses/${w}/locations`, { code: "A-01", type: "BIN" });

    const rename = await call("PATCH", `/warehouses/${w}/locations/A-01`, {
      version: 1,
      code: "A-02",
    });
    expect(rename.status).toBe(400);
    const move = await call("PATCH", `/warehouses/${w}/locations/A-01`, {
      version: 1,
      warehouseId: other,
    });
    expect(move.status).toBe(400);
  });

  it("lists locations with filters and pages", async () => {
    const { call, newWarehouse } = await setup();
    const w = await newWarehouse();
    for (const code of ["L-1", "L-2", "L-3"]) {
      await call("POST", `/warehouses/${w}/locations`, { code, type: "BIN" });
    }
    await call("PATCH", `/warehouses/${w}/locations/L-2`, { version: 1, isActive: false });

    const page = await call("GET", `/warehouses/${w}/locations?limit=2`);
    expect(page.status).toBe(200);
    expect(page.body.items.map((l: { code: string }) => l.code)).toEqual(["L-1", "L-2"]);
    expect(page.body.nextAfter).toBe("L-2");

    const rest = await call("GET", `/warehouses/${w}/locations?limit=2&after=L-2`);
    expect(rest.body.items.map((l: { code: string }) => l.code)).toEqual(["L-3"]);
    expect(rest.body.nextAfter).toBeNull();

    const active = await call("GET", `/warehouses/${w}/locations?active=true`);
    expect(active.body.items.map((l: { code: string }) => l.code)).toEqual(["L-1", "L-3"]);

    expect((await call("GET", `/warehouses/${w}/locations?limit=0`)).status).toBe(400);
    expect((await call("GET", `/warehouses/${w}/locations?bogus=1`)).status).toBe(400);
  });

  it("answers 422 for an unknown type or storage class", async () => {
    const { call, newWarehouse } = await setup();
    const w = await newWarehouse();
    const type = await call("POST", `/warehouses/${w}/locations`, { code: "X-1", type: "NOPE" });
    expect(type.status).toBe(422);
    const cls = await call("POST", `/warehouses/${w}/locations`, {
      code: "X-2",
      type: "BIN",
      storageClasses: ["LAVA"],
    });
    expect(cls.status).toBe(422);
  });

  it("lists and extends the reference data", async () => {
    const { call } = await setup();
    const types = await call("GET", "/location-types");
    expect(types.body.items.map((t: { code: string }) => t.code)).toEqual(
      expect.arrayContaining(["BIN", "PALLET", "FLOOR", "STAGING"]),
    );
    const created = await call("POST", "/location-types", { code: "SHELF", name: "Open shelf" });
    expect(created.status).toBe(201);
    expect((await call("POST", "/location-types", { code: "shelf", name: "Again" })).status).toBe(
      409,
    );

    const classes = await call("GET", "/storage-classes");
    expect(classes.body.items.map((c: { code: string }) => c.code)).toContain("AMBIENT");
    expect(
      (await call("POST", "/storage-classes", { code: "CHILLED", name: "Chilled" })).status,
    ).toBe(201);
  });
});
