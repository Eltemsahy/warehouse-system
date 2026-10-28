import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const enabled = process.env.LEDGER_DRIVER === "postgres";

/** The SQLSTATE of the error a statement raises, or undefined when it succeeds. */
async function sqlState(statement: Promise<unknown>): Promise<string | undefined> {
  try {
    await statement;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INTEGRITY_VIOLATION = "23000"; // raised by the immutability triggers

describe.skipIf(!enabled)("locations schema (postgres)", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  afterAll(() => pool.end());

  const uniq = () => randomUUID().slice(0, 8);

  async function addWarehouse(code = `WH-${uniq()}`) {
    const id = randomUUID();
    await pool.query("INSERT INTO locations.warehouse (id, code, name) VALUES ($1, $2, 'Test')", [
      id,
      code,
    ]);
    return id;
  }

  async function addZone(warehouseId: string, code = `Z-${uniq()}`) {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO locations.zone (id, warehouse_id, code, type) VALUES ($1, $2, $3, 'STORAGE')",
      [id, warehouseId, code],
    );
    return id;
  }

  /** Inserts a BIN location; the statement is returned so callers can inspect its failure. */
  const addLocation = (warehouseId: string, code: string, zoneId: string | null = null) =>
    pool.query(
      `INSERT INTO locations.location (id, warehouse_id, zone_id, location_type_id, code)
       SELECT $1::uuid, $2::uuid, $3::uuid, id, $4::text FROM locations.location_type WHERE code = 'BIN'`,
      [randomUUID(), warehouseId, zoneId, code],
    );

  it("seeds the reference data", async () => {
    const types = await pool.query("SELECT code FROM locations.location_type");
    const classes = await pool.query("SELECT code FROM locations.storage_class");
    expect(types.rows.map((r) => r.code)).toEqual(
      expect.arrayContaining(["BIN", "PALLET", "FLOOR", "STAGING"]),
    );
    expect(classes.rows.map((r) => r.code)).toEqual(
      expect.arrayContaining(["AMBIENT", "COLD", "FROZEN", "HAZMAT"]),
    );
  });

  it("rejects codes with the wrong format", async () => {
    for (const bad of ["has space", "", "x".repeat(65), "semi;colon"]) {
      const state = await sqlState(
        pool.query("INSERT INTO locations.warehouse (id, code, name) VALUES ($1, $2, 'x')", [
          randomUUID(),
          bad,
        ]),
      );
      expect(state, JSON.stringify(bad)).toBe(CHECK_VIOLATION);
    }
  });

  it("rejects an unknown warehouse status", async () => {
    const state = await sqlState(
      pool.query(
        "INSERT INTO locations.warehouse (id, code, name, status) VALUES ($1, $2, 'x', 'WEIRD')",
        [randomUUID(), `WH-${uniq()}`],
      ),
    );
    expect(state).toBe(CHECK_VIOLATION);
  });

  it("keeps location codes unique per warehouse, ignoring case", async () => {
    const [w1, w2] = [await addWarehouse(), await addWarehouse()];
    await addLocation(w1, "A-01");
    expect(await sqlState(addLocation(w1, "a-01"))).toBe(UNIQUE_VIOLATION);
    expect(await sqlState(addLocation(w2, "A-01"))).toBeUndefined();
  });

  it("keeps warehouse codes unique organisation-wide, ignoring case", async () => {
    const code = `Main-${uniq()}`;
    await addWarehouse(code);
    expect(await sqlState(addWarehouse(code.toUpperCase()))).toBe(UNIQUE_VIOLATION);
  });

  it("refuses to change a code", async () => {
    const [w] = [await addWarehouse()];
    const zone = await addZone(w);
    await addLocation(w, "A-01");

    const location = pool.query(
      "UPDATE locations.location SET code = 'A-02' WHERE code = 'A-01' AND warehouse_id = $1",
      [w],
    );
    const zoneUpdate = pool.query("UPDATE locations.zone SET code = 'NEW' WHERE id = $1", [zone]);
    const warehouseUpdate = pool.query(
      "UPDATE locations.warehouse SET code = 'NEW-CODE' WHERE id = $1",
      [w],
    );
    expect(await sqlState(location)).toBe(INTEGRITY_VIOLATION);
    expect(await sqlState(zoneUpdate)).toBe(INTEGRITY_VIOLATION);
    expect(await sqlState(warehouseUpdate)).toBe(INTEGRITY_VIOLATION);
  });

  it("refuses to move a zone or a location to another warehouse", async () => {
    const [w1, w2] = [await addWarehouse(), await addWarehouse()];
    const zone = await addZone(w1);
    await addLocation(w1, "A-01");

    const moveZone = pool.query("UPDATE locations.zone SET warehouse_id = $2 WHERE id = $1", [
      zone,
      w2,
    ]);
    const moveLocation = pool.query(
      "UPDATE locations.location SET warehouse_id = $2 WHERE code = 'A-01' AND warehouse_id = $1",
      [w1, w2],
    );
    expect(await sqlState(moveZone)).toBe(INTEGRITY_VIOLATION);
    expect(await sqlState(moveLocation)).toBe(INTEGRITY_VIOLATION);
  });

  it("refuses a location whose zone belongs to another warehouse", async () => {
    const [w1, w2] = [await addWarehouse(), await addWarehouse()];
    const foreignZone = await addZone(w2);
    expect(await sqlState(addLocation(w1, "A-01", foreignZone))).toBe(FOREIGN_KEY_VIOLATION);
    const ownZone = await addZone(w1);
    expect(await sqlState(addLocation(w1, "A-02", ownZone))).toBeUndefined();
  });

  it("limits the length of the position fields", async () => {
    const w = await addWarehouse();
    await addLocation(w, "A-01");
    const empty = pool.query(
      "UPDATE locations.location SET aisle = '' WHERE code = 'A-01' AND warehouse_id = $1",
      [w],
    );
    const long = pool.query(
      "UPDATE locations.location SET bay = $2 WHERE code = 'A-01' AND warehouse_id = $1",
      [w, "x".repeat(33)],
    );
    expect(await sqlState(empty)).toBe(CHECK_VIOLATION);
    expect(await sqlState(long)).toBe(CHECK_VIOLATION);
  });

  it("refuses negative capacities", async () => {
    const w = await addWarehouse();
    await addLocation(w, "A-01");
    const { rows } = await pool.query(
      "SELECT id FROM locations.location WHERE code = 'A-01' AND warehouse_id = $1",
      [w],
    );
    const id = rows[0].id as string;
    const state = await sqlState(
      pool.query(
        "INSERT INTO locations.location_capacity (location_id, max_units) VALUES ($1, -1)",
        [id],
      ),
    );
    expect(state).toBe(CHECK_VIOLATION);
  });
});
