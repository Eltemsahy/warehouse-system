import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LocationsRepository } from "../../modules/locations/application/ports.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/locations/domain/errors.js";
import type {
  Location,
  LocationType,
  StorageClass,
  Warehouse,
  Zone,
} from "../../modules/locations/domain/model.js";

type RepoFactory = () => LocationsRepository | Promise<LocationsRepository>;

const uniq = () => randomUUID().slice(0, 8);
const audit = () => ({
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  version: 1,
});

const warehouse = (over: Partial<Warehouse> = {}): Warehouse => ({
  id: randomUUID(),
  code: `WH-${uniq()}`,
  name: "Main warehouse",
  address: null,
  timezone: "UTC",
  status: "ACTIVE",
  ...audit(),
  ...over,
});

const zone = (warehouseId: string, over: Partial<Zone> = {}): Zone => ({
  id: randomUUID(),
  warehouseId,
  code: `Z-${uniq()}`,
  type: "STORAGE",
  isActive: true,
  ...audit(),
  ...over,
});

async function typeRef(repo: LocationsRepository, code = "BIN") {
  const t = await repo.getLocationTypeByCode(code);
  if (!t) throw new Error(`seeded location type ${code} is missing`);
  return {
    id: t.id,
    code: t.code,
    isPickable: t.isPickable,
    isStorable: t.isStorable,
    isStaging: t.isStaging,
  };
}

async function classRefs(repo: LocationsRepository, codes: string[]) {
  const found = await repo.getStorageClassesByCodes(codes);
  return found.map((c) => ({ id: c.id, code: c.code })).sort((a, b) => (a.code < b.code ? -1 : 1));
}

async function location(
  repo: LocationsRepository,
  warehouseId: string,
  code: string,
  over: Partial<Location> = {},
): Promise<Location> {
  return {
    id: randomUUID(),
    warehouseId,
    zoneId: null,
    type: await typeRef(repo),
    code,
    aisle: null,
    bay: null,
    level: null,
    position: null,
    status: "AVAILABLE",
    isActive: true,
    capacity: null,
    storageClasses: [],
    ...audit(),
    ...over,
  };
}

const locationType = (over: Partial<LocationType> = {}): LocationType => ({
  id: randomUUID(),
  code: `T-${uniq()}`,
  name: "Test type",
  isPickable: true,
  isStorable: true,
  isStaging: false,
  ...audit(),
  ...over,
});

const storageClass = (over: Partial<StorageClass> = {}): StorageClass => ({
  id: randomUUID(),
  code: `C-${uniq()}`,
  name: "Test class",
  ...audit(),
  ...over,
});

/**
 * The LocationsRepository contract (Implementation Plan P1-3, ADR 0004). Every adapter must
 * pass this exact suite.
 */
export function locationsRepositoryContract(
  name: string,
  factory: RepoFactory,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`LocationsRepository contract: ${name}`, () => {
    describe("warehouses", () => {
      it("stores a warehouse and reads it back", async () => {
        const repo = await factory();
        const w = warehouse({ address: "1 Harbour Road", timezone: "Africa/Cairo" });
        const stored = await repo.insertWarehouse(w);
        expect(stored).toMatchObject({
          id: w.id,
          code: w.code,
          name: w.name,
          address: "1 Harbour Road",
          timezone: "Africa/Cairo",
          status: "ACTIVE",
          version: 1,
        });
        expect(await repo.getWarehouse(w.id)).toMatchObject({ id: w.id, code: w.code });
      });

      it("returns null for an unknown warehouse", async () => {
        const repo = await factory();
        expect(await repo.getWarehouse(randomUUID())).toBeNull();
      });

      it("lists the warehouses it holds", async () => {
        const repo = await factory();
        const w = warehouse();
        await repo.insertWarehouse(w);
        const ids = (await repo.listWarehouses()).map((x) => x.id);
        expect(ids).toContain(w.id);
      });

      it("rejects a duplicate code, ignoring case", async () => {
        const repo = await factory();
        const w = warehouse({ code: `Main-${uniq()}` });
        await repo.insertWarehouse(w);
        await expect(
          repo.insertWarehouse(warehouse({ code: w.code.toUpperCase() })),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it("updates fields, bumps the version and never changes the code", async () => {
        const repo = await factory();
        const stored = await repo.insertWarehouse(warehouse());
        const updated = await repo.updateWarehouse(
          { ...stored, name: "Renamed", status: "INACTIVE", code: "HACKED" },
          1,
        );
        expect(updated.name).toBe("Renamed");
        expect(updated.status).toBe("INACTIVE");
        expect(updated.code).toBe(stored.code);
        expect(updated.version).toBe(2);
      });

      it("rejects a stale version and an unknown warehouse", async () => {
        const repo = await factory();
        const stored = await repo.insertWarehouse(warehouse());
        await repo.updateWarehouse({ ...stored, name: "First" }, 1);
        await expect(repo.updateWarehouse({ ...stored, name: "Second" }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
        await expect(
          repo.updateWarehouse({ ...stored, id: randomUUID() }, 1),
        ).rejects.toBeInstanceOf(NotFoundError);
      });
    });

    describe("zones", () => {
      it("stores a zone inside a warehouse", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const z = await repo.insertZone(zone(w.id, { type: "PICKING" }));
        expect(z).toMatchObject({ warehouseId: w.id, type: "PICKING", isActive: true, version: 1 });
        expect((await repo.listZones(w.id)).map((x) => x.id)).toEqual([z.id]);
      });

      it("rejects a zone for an unknown warehouse", async () => {
        const repo = await factory();
        await expect(repo.insertZone(zone(randomUUID()))).rejects.toBeInstanceOf(
          RuleViolationError,
        );
      });

      it("keeps zone codes unique per warehouse, ignoring case", async () => {
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        await repo.insertZone(zone(w1.id, { code: "Z-A" }));
        await expect(repo.insertZone(zone(w1.id, { code: "z-a" }))).rejects.toBeInstanceOf(
          ConflictError,
        );
        // The same code in another warehouse is fine.
        await expect(repo.insertZone(zone(w2.id, { code: "Z-A" }))).resolves.toMatchObject({
          code: "Z-A",
        });
      });

      it("only finds a zone through its own warehouse", async () => {
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        const z = await repo.insertZone(zone(w1.id));
        expect(await repo.getZone(w1.id, z.id)).not.toBeNull();
        expect(await repo.getZone(w2.id, z.id)).toBeNull();
      });

      it("updates type and active flag with the version check", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const z = await repo.insertZone(zone(w.id));
        const updated = await repo.updateZone({ ...z, type: "QUARANTINE", isActive: false }, 1);
        expect(updated).toMatchObject({ type: "QUARANTINE", isActive: false, version: 2 });
        await expect(repo.updateZone({ ...z, isActive: true }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
      });
    });

    describe("locations", () => {
      it("stores a location and finds it by its exact code", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const stored = await repo.insertLocation(
          await location(repo, w.id, "A-01", { aisle: "A", bay: "01", level: "1", position: "L" }),
        );
        expect(stored).toMatchObject({
          warehouseId: w.id,
          code: "A-01",
          aisle: "A",
          bay: "01",
          level: "1",
          position: "L",
          status: "AVAILABLE",
          isActive: true,
          capacity: null,
          storageClasses: [],
          version: 1,
        });
        expect(stored.type).toMatchObject({ code: "BIN", isPickable: true, isStorable: true });
        expect(await repo.getLocation(w.id, "A-01")).toMatchObject({ id: stored.id });
      });

      it("matches the code exactly: a different case finds nothing", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        await repo.insertLocation(await location(repo, w.id, "A-01"));
        expect(await repo.getLocation(w.id, "a-01")).toBeNull();
        expect(await repo.getLocation(w.id, "B-99")).toBeNull();
      });

      it("rejects a duplicate code in a warehouse, ignoring case", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        await repo.insertLocation(await location(repo, w.id, "A-01"));
        await expect(
          repo.insertLocation(await location(repo, w.id, "a-01")),
        ).rejects.toBeInstanceOf(ConflictError);
      });

      it("lets two warehouses both have an A-01", async () => {
        // Regression for G13 on the master-data side: ADR 0004 scopes codes per warehouse.
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        const a = await repo.insertLocation(await location(repo, w1.id, "A-01"));
        const b = await repo.insertLocation(await location(repo, w2.id, "A-01"));
        expect(a.id).not.toBe(b.id);
        expect((await repo.getLocation(w1.id, "A-01"))?.id).toBe(a.id);
        expect((await repo.getLocation(w2.id, "A-01"))?.id).toBe(b.id);
      });

      it("rejects a location for an unknown warehouse", async () => {
        const repo = await factory();
        await expect(
          repo.insertLocation(await location(repo, randomUUID(), "A-01")),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("rejects a zone that belongs to another warehouse", async () => {
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        const foreignZone = await repo.insertZone(zone(w2.id));
        await expect(
          repo.insertLocation(await location(repo, w1.id, "A-01", { zoneId: foreignZone.id })),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("keeps capacity and storage classes, sorted by code", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const stored = await repo.insertLocation(
          await location(repo, w.id, "C-01", {
            capacity: { maxUnits: 100, maxWeight: 12.5, maxVolume: null, maxLpns: 2 },
            storageClasses: await classRefs(repo, ["COLD", "AMBIENT"]),
          }),
        );
        expect(stored.capacity).toEqual({
          maxUnits: 100,
          maxWeight: 12.5,
          maxVolume: null,
          maxLpns: 2,
        });
        expect(stored.storageClasses.map((c) => c.code)).toEqual(["AMBIENT", "COLD"]);
      });

      it("updates a location, replacing capacity and storage classes", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const z = await repo.insertZone(zone(w.id));
        const stored = await repo.insertLocation(
          await location(repo, w.id, "A-01", {
            capacity: { maxUnits: 5, maxWeight: null, maxVolume: null, maxLpns: null },
            storageClasses: await classRefs(repo, ["AMBIENT"]),
          }),
        );

        const updated = await repo.updateLocation(
          {
            ...stored,
            zoneId: z.id,
            type: await typeRef(repo, "PALLET"),
            status: "BLOCKED",
            isActive: false,
            aisle: "Z",
            capacity: null,
            storageClasses: await classRefs(repo, ["COLD", "FROZEN"]),
            code: "HACKED", // ignored: codes never change
          },
          1,
        );

        expect(updated).toMatchObject({
          code: "A-01",
          zoneId: z.id,
          status: "BLOCKED",
          isActive: false,
          aisle: "Z",
          capacity: null,
          version: 2,
        });
        expect(updated.type.code).toBe("PALLET");
        expect(updated.storageClasses.map((c) => c.code)).toEqual(["COLD", "FROZEN"]);
        expect(await repo.getLocation(w.id, "A-01")).toMatchObject({ version: 2, isActive: false });
      });

      it("rejects a stale version and an unknown location on update", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const stored = await repo.insertLocation(await location(repo, w.id, "A-01"));
        await repo.updateLocation({ ...stored, aisle: "X" }, 1);
        await expect(repo.updateLocation({ ...stored, aisle: "Y" }, 1)).rejects.toBeInstanceOf(
          ConflictError,
        );
        await expect(
          repo.updateLocation({ ...stored, id: randomUUID() }, 1),
        ).rejects.toBeInstanceOf(NotFoundError);
      });

      it("rejects a zone from another warehouse on update", async () => {
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        const foreignZone = await repo.insertZone(zone(w2.id));
        const stored = await repo.insertLocation(await location(repo, w1.id, "A-01"));
        await expect(
          repo.updateLocation({ ...stored, zoneId: foreignZone.id }, 1),
        ).rejects.toBeInstanceOf(RuleViolationError);
      });

      it("lists in code order with keyset pagination", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        for (const code of ["L-03", "L-01", "L-05", "L-02", "L-04"]) {
          await repo.insertLocation(await location(repo, w.id, code));
        }

        const page1 = await repo.listLocations(w.id, { limit: 2 });
        expect(page1.items.map((l) => l.code)).toEqual(["L-01", "L-02"]);
        expect(page1.nextAfter).toBe("L-02");

        const page2 = await repo.listLocations(w.id, { limit: 2, after: page1.nextAfter ?? "" });
        expect(page2.items.map((l) => l.code)).toEqual(["L-03", "L-04"]);
        expect(page2.nextAfter).toBe("L-04");

        const page3 = await repo.listLocations(w.id, { limit: 2, after: page2.nextAfter ?? "" });
        expect(page3.items.map((l) => l.code)).toEqual(["L-05"]);
        expect(page3.nextAfter).toBeNull();
      });

      it("filters by zone, type, status and active flag", async () => {
        const repo = await factory();
        const w = await repo.insertWarehouse(warehouse());
        const z = await repo.insertZone(zone(w.id));
        await repo.insertLocation(await location(repo, w.id, "F-01", { zoneId: z.id }));
        await repo.insertLocation(
          await location(repo, w.id, "F-02", { type: await typeRef(repo, "PALLET") }),
        );
        await repo.insertLocation(await location(repo, w.id, "F-03", { status: "BLOCKED" }));
        await repo.insertLocation(await location(repo, w.id, "F-04", { isActive: false }));

        const codes = async (filter: Parameters<LocationsRepository["listLocations"]>[1]) =>
          (await repo.listLocations(w.id, filter)).items.map((l) => l.code);

        expect(await codes({ limit: 50, zoneId: z.id })).toEqual(["F-01"]);
        expect(await codes({ limit: 50, typeCode: "pallet" })).toEqual(["F-02"]);
        expect(await codes({ limit: 50, status: "BLOCKED" })).toEqual(["F-03"]);
        expect(await codes({ limit: 50, isActive: false })).toEqual(["F-04"]);
        expect(await codes({ limit: 50, isActive: true })).toEqual(["F-01", "F-02", "F-03"]);
      });

      it("lists only the locations of the requested warehouse", async () => {
        const repo = await factory();
        const [w1, w2] = [
          await repo.insertWarehouse(warehouse()),
          await repo.insertWarehouse(warehouse()),
        ];
        await repo.insertLocation(await location(repo, w1.id, "A-01"));
        await repo.insertLocation(await location(repo, w2.id, "B-01"));
        expect((await repo.listLocations(w1.id, { limit: 50 })).items.map((l) => l.code)).toEqual([
          "A-01",
        ]);
      });
    });

    describe("reference data", () => {
      it("starts with the seeded location types", async () => {
        const repo = await factory();
        const types = await repo.listLocationTypes();
        const byCode = new Map(types.map((t) => [t.code, t]));
        expect(byCode.get("BIN")).toMatchObject({
          isPickable: true,
          isStorable: true,
          isStaging: false,
        });
        expect(byCode.get("PALLET")).toMatchObject({ isPickable: false, isStorable: true });
        expect(byCode.get("FLOOR")).toMatchObject({ isStorable: true });
        expect(byCode.get("STAGING")).toMatchObject({ isStaging: true, isStorable: false });
      });

      it("starts with the seeded storage classes", async () => {
        const repo = await factory();
        const codes = (await repo.listStorageClasses()).map((c) => c.code);
        for (const code of ["AMBIENT", "COLD", "FROZEN", "HAZMAT"]) expect(codes).toContain(code);
      });

      it("looks up types and classes ignoring case, and skips unknown classes", async () => {
        const repo = await factory();
        expect((await repo.getLocationTypeByCode("bin"))?.code).toBe("BIN");
        expect(await repo.getLocationTypeByCode("NOPE")).toBeNull();
        const found = await repo.getStorageClassesByCodes(["ambient", "NOPE"]);
        expect(found.map((c) => c.code)).toEqual(["AMBIENT"]);
      });

      it("adds types and classes, rejecting duplicate codes ignoring case", async () => {
        const repo = await factory();
        const t = await repo.insertLocationType(locationType());
        await expect(
          repo.insertLocationType(locationType({ code: t.code.toLowerCase() })),
        ).rejects.toBeInstanceOf(ConflictError);

        const c = await repo.insertStorageClass(storageClass());
        await expect(
          repo.insertStorageClass(storageClass({ code: c.code.toLowerCase() })),
        ).rejects.toBeInstanceOf(ConflictError);
      });
    });
  });
}
