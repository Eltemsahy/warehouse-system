import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { errorHandler } from "../../apps/api/src/http.js";
import type { Result } from "../../shared/kernel/index.js";
import { createCatalogModule } from "../../modules/catalog/index.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/catalog/domain/errors.js";
import { closeServers, serve } from "../helpers/serve.js";

afterAll(closeServers);

const uniq = () => randomUUID().slice(0, 8);

function must<T>(result: Result<T, Error>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function expectError(
  result: Result<unknown, Error>,
  kind: new (...args: never[]) => Error,
  label = "",
) {
  expect(result.ok, label).toBe(false);
  if (!result.ok) expect(result.error, label).toBeInstanceOf(kind);
}

/** A module with one item that has a base unit (EA) and a case unit (CS, 12 each). */
async function withItem(sku = "JAM-1") {
  const m = createCatalogModule();
  must(
    await m.items.create({
      sku,
      description: "Strawberry jam",
      baseUom: "EA",
      isLotTracked: true,
      units: [{ uom: "CS", qtyInBase: 12 }],
    }),
  );
  return m;
}

describe("barcodes", () => {
  it("adds barcodes to the units of an item and lists them in order", async () => {
    const m = await withItem();
    const cs = must(await m.barcodes.add("JAM-1", { barcode: "9999", uom: "cs", type: "ITF14" }));
    expect(cs).toEqual({ barcode: "9999", type: "ITF14", uom: "CS", qtyInBase: 12 });
    must(await m.barcodes.add("JAM-1", { barcode: "1111", uom: "EA" })); // type defaults to OTHER

    expect(must(await m.barcodes.list("JAM-1"))).toEqual([
      { barcode: "1111", type: "OTHER", uom: "EA", qtyInBase: 1 },
      { barcode: "9999", type: "ITF14", uom: "CS", qtyInBase: 12 },
    ]);
  });

  it("scanning a case barcode says it is twelve each", async () => {
    const m = await withItem();
    must(await m.barcodes.add("JAM-1", { barcode: "CASE-001", uom: "CS" }));
    const scan = must(await m.barcodes.resolve("CASE-001"));
    expect(scan).toMatchObject({ barcode: "CASE-001", uom: "CS", qtyInBase: 12 });
    expect(scan.item.sku).toBe("JAM-1");
  });

  it("matches exactly: another case finds nothing", async () => {
    const m = await withItem();
    must(await m.barcodes.add("JAM-1", { barcode: "AbC123", uom: "EA" }));
    expectError(await m.barcodes.resolve("ABC123"), NotFoundError);
    expectError(await m.barcodes.resolve("nope"), NotFoundError);
  });

  it("enforces its rules", async () => {
    const m = await withItem();
    must(await m.items.create({ sku: "OTHER-1", description: "Other", baseUom: "EA" }));
    must(await m.barcodes.add("JAM-1", { barcode: "TAKEN", uom: "EA" }));

    expectError(
      await m.barcodes.add("JAM-1", { barcode: "has space", uom: "EA" }),
      RuleViolationError,
      "format",
    );
    expectError(
      await m.barcodes.add("JAM-1", { barcode: "X1", uom: "EA", type: "WEIRD" as never }),
      RuleViolationError,
      "type",
    );
    expectError(
      await m.barcodes.add("JAM-1", { barcode: "X2", uom: "PL" }),
      RuleViolationError,
      "unit the item lacks",
    );
    expectError(
      await m.barcodes.add("MISSING", { barcode: "X3", uom: "EA" }),
      NotFoundError,
      "unknown item",
    );
    expectError(
      await m.barcodes.add("OTHER-1", { barcode: "TAKEN", uom: "EA" }),
      ConflictError,
      "duplicate on another item",
    );
  });

  it("removes a barcode, after which it no longer scans", async () => {
    const m = await withItem();
    must(await m.items.create({ sku: "OTHER-1", description: "Other", baseUom: "EA" }));
    must(await m.barcodes.add("JAM-1", { barcode: "GONE", uom: "EA" }));

    expectError(await m.barcodes.remove("OTHER-1", "GONE"), NotFoundError, "wrong item");
    must(await m.barcodes.remove("JAM-1", "GONE"));
    expectError(await m.barcodes.resolve("GONE"), NotFoundError);
    expectError(await m.barcodes.remove("JAM-1", "GONE"), NotFoundError, "already removed");
    expect(must(await m.barcodes.list("JAM-1"))).toEqual([]);
  });

  it("an inactive item still scans, and says so", async () => {
    const m = await withItem();
    must(await m.barcodes.add("JAM-1", { barcode: "OLD-1", uom: "EA" }));
    must(await m.items.update("JAM-1", { version: 1, status: "INACTIVE" }));
    expect(must(await m.barcodes.resolve("OLD-1")).item.status).toBe("INACTIVE");
  });
});

describe("public queries (used by inventory in P1-5)", () => {
  it("getItem returns a small view, matching the SKU exactly", async () => {
    const m = await withItem("Jam-1");
    expect(await m.getItem("Jam-1")).toMatchObject({
      sku: "Jam-1",
      description: "Strawberry jam",
      baseUom: "EA",
      isActive: true,
      isLotTracked: true,
      isSerialTracked: false,
      hasExpiry: false,
      shelfLifeDays: null,
    });
    expect(await m.getItem("jam-1")).toBeNull();
    expect(await m.getItem("MISSING")).toBeNull();
  });

  it("exists is true only for an active SKU", async () => {
    const m = await withItem();
    expect(await m.exists("JAM-1")).toBe(true);
    expect(await m.exists("MISSING")).toBe(false);

    must(await m.items.update("JAM-1", { version: 1, status: "INACTIVE" }));
    expect(await m.exists("JAM-1")).toBe(false);
    expect((await m.getItem("JAM-1"))?.isActive).toBe(false); // still resolvable, for draining stock
  });

  it("resolveBarcode returns the item and the quantity one scan stands for", async () => {
    const m = await withItem();
    must(await m.barcodes.add("JAM-1", { barcode: "CASE-9", uom: "CS" }));
    const scan = await m.resolveBarcode("CASE-9");
    expect(scan).toMatchObject({ barcode: "CASE-9", uom: "CS", qtyInBase: 12 });
    expect(scan?.item).toMatchObject({ sku: "JAM-1", baseUom: "EA", isActive: true });
    expect(await m.resolveBarcode("NOPE")).toBeNull();
  });
});

interface ApiBody {
  barcode: string;
  uom: string;
  qtyInBase: number;
  error: string;
  items: { barcode: string; uom: string }[];
  item: { sku: string; status: string };
  [key: string]: unknown;
}

describe("barcode API", () => {
  async function setup() {
    const m = await withItem(`SKU-${uniq()}`);
    const sku = (await m.items.list({ limit: 1 })).ok
      ? (must(await m.items.list({ limit: 1 })).items[0]?.sku ?? "")
      : "";
    const app = express();
    app.use(express.json());
    app.use("/catalog", m.router);
    app.use(errorHandler);
    const url = await serve(app);
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${url}/catalog${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : {}) as ApiBody };
    };
    return { call, sku };
  }

  it("adds, lists, scans and removes a barcode", async () => {
    const { call, sku } = await setup();
    const added = await call("POST", `/items/${sku}/barcodes`, {
      barcode: "CASE-1",
      uom: "CS",
      type: "ITF14",
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ barcode: "CASE-1", uom: "CS", qtyInBase: 12 });

    const listed = await call("GET", `/items/${sku}/barcodes`);
    expect(listed.body.items.map((b) => b.barcode)).toEqual(["CASE-1"]);

    const scan = await call("GET", "/barcodes/CASE-1");
    expect(scan.status).toBe(200);
    expect(scan.body).toMatchObject({ uom: "CS", qtyInBase: 12 });
    expect(scan.body.item.sku).toBe(sku);

    expect((await call("DELETE", `/items/${sku}/barcodes/CASE-1`)).status).toBe(204);
    expect((await call("GET", "/barcodes/CASE-1")).status).toBe(404);
    expect((await call("DELETE", `/items/${sku}/barcodes/CASE-1`)).status).toBe(404);
  });

  it("validates the request: 400, 404, 409 and 422", async () => {
    const { call, sku } = await setup();
    expect((await call("POST", `/items/${sku}/barcodes`, { uom: "EA" })).status).toBe(400);
    expect(
      (await call("POST", `/items/${sku}/barcodes`, { barcode: "has space", uom: "EA" })).status,
    ).toBe(400);
    expect(
      (await call("POST", `/items/${sku}/barcodes`, { barcode: "B1", uom: "EA", extra: 1 })).status,
    ).toBe(400);
    expect(
      (await call("POST", "/items/MISSING/barcodes", { barcode: "B1", uom: "EA" })).status,
    ).toBe(404);
    expect(
      (await call("POST", `/items/${sku}/barcodes`, { barcode: "B1", uom: "PL" })).status,
    ).toBe(422);

    expect(
      (await call("POST", `/items/${sku}/barcodes`, { barcode: "DUP", uom: "EA" })).status,
    ).toBe(201);
    expect(
      (await call("POST", `/items/${sku}/barcodes`, { barcode: "DUP", uom: "CS" })).status,
    ).toBe(409);
    expect((await call("GET", "/barcodes/UNKNOWN")).status).toBe(404);
  });
});
