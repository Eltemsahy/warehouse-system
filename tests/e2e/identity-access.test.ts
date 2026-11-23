import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import {
  can,
  createIdentityModule,
  InMemoryIdentityRepository,
  NO_ACCESS,
  ScryptPasswordHasher,
} from "../../modules/identity/index.js";
import { NotFoundError, RuleViolationError } from "../../modules/identity/domain/errors.js";

const hasher = new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 });
const WAREHOUSE = "11111111-1111-4111-8111-111111111111";

function setup(known: string[] = [WAREHOUSE]) {
  const directory = new Set(known);
  return createIdentityModule({
    repository: new InMemoryIdentityRepository(),
    hasher,
    warehouses: { exists: async (id) => directory.has(id) },
  });
}
type Module = ReturnType<typeof setup>;

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

let counter = 0;
const addUser = async (m: Module) => {
  counter += 1;
  return must(
    await m.users.create({
      username: `user${counter}`,
      displayName: `User ${counter}`,
      password: "a long enough passphrase",
    }),
  );
};

describe("roles", () => {
  it("assigns, lists and removes roles, and assigning twice is fine", async () => {
    const m = setup();
    const u = await addUser(m);
    must(await m.access.assignRole(u.id, "PICKER"));
    must(await m.access.assignRole(u.id, "PICKER"));
    must(await m.access.assignRole(u.id, "PACKER"));
    expect(must(await m.access.rolesOf(u.id)).map((r) => r.code)).toEqual(["PACKER", "PICKER"]);
    must(await m.access.removeRole(u.id, "PACKER"));
    expect(must(await m.access.rolesOf(u.id)).map((r) => r.code)).toEqual(["PICKER"]);
  });

  it("says what is missing", async () => {
    const m = setup();
    const u = await addUser(m);
    expectError(await m.access.assignRole(u.id, "NO_SUCH_ROLE"), NotFoundError, "role");
    expectError(await m.access.assignRole(randomUUID(), "PICKER"), NotFoundError, "user");
    expectError(await m.access.removeRole(u.id, "PICKER"), NotFoundError, "not assigned");
    expectError(await m.access.rolesOf(randomUUID()), NotFoundError, "user");
  });

  it("always keeps one active administrator", async () => {
    const m = setup();
    const [a, b] = [await addUser(m), await addUser(m)];
    must(await m.access.assignRole(a.id, "ADMIN"));

    expectError(
      await m.access.removeRole(a.id, "ADMIN"),
      RuleViolationError,
      "sole admin loses role",
    );
    expectError(
      await m.users.update(a.id, { version: 1, status: "DISABLED" }),
      RuleViolationError,
      "sole admin disabled",
    );

    must(await m.access.assignRole(b.id, "ADMIN"));
    must(await m.users.update(a.id, { version: 1, status: "DISABLED" })); // b is still there
    // a is disabled, so b is now the last active one
    expectError(
      await m.access.removeRole(b.id, "ADMIN"),
      RuleViolationError,
      "disabled admins do not count",
    );
    expectError(await m.users.update(b.id, { version: 1, status: "DISABLED" }), RuleViolationError);
    must(await m.access.removeRole(a.id, "ADMIN")); // a is not active, so this changes nothing that matters
  });

  it("lets other users be disabled freely", async () => {
    const m = setup();
    const [admin, clerk] = [await addUser(m), await addUser(m)];
    must(await m.access.assignRole(admin.id, "ADMIN"));
    must(await m.access.assignRole(clerk.id, "PICKER"));
    expect(must(await m.users.update(clerk.id, { version: 1, status: "DISABLED" })).status).toBe(
      "DISABLED",
    );
  });
});

describe("warehouse access", () => {
  it("grants and revokes, normalising the id and ignoring repeats", async () => {
    const m = setup();
    const u = await addUser(m);
    must(await m.access.grantWarehouse(u.id, WAREHOUSE.toUpperCase()));
    must(await m.access.grantWarehouse(u.id, WAREHOUSE));
    expect(must(await m.access.warehousesOf(u.id))).toEqual([WAREHOUSE]);
    must(await m.access.revokeWarehouse(u.id, WAREHOUSE.toUpperCase()));
    expectError(await m.access.revokeWarehouse(u.id, WAREHOUSE), NotFoundError, "already revoked");
    expect(must(await m.access.warehousesOf(u.id))).toEqual([]);
  });

  it("enforces its rules", async () => {
    const m = setup();
    const u = await addUser(m);
    expectError(await m.access.grantWarehouse(u.id, "not-a-uuid"), RuleViolationError, "format");
    expectError(
      await m.access.grantWarehouse(u.id, randomUUID()),
      RuleViolationError,
      "unknown warehouse",
    );
    expectError(
      await m.access.grantWarehouse(randomUUID(), WAREHOUSE),
      NotFoundError,
      "unknown user",
    );
    expectError(await m.access.warehousesOf(randomUUID()), NotFoundError, "unknown user");
  });

  it("can remove a grant for a warehouse that no longer exists", async () => {
    const repository = new InMemoryIdentityRepository();
    const gone = randomUUID();
    const before = createIdentityModule({
      repository,
      hasher,
      warehouses: { exists: async () => true },
    });
    const after = createIdentityModule({
      repository,
      hasher,
      warehouses: { exists: async () => false },
    });

    const u = await addUser(before);
    must(await before.access.grantWarehouse(u.id, gone));
    expectError(
      await after.access.grantWarehouse(u.id, randomUUID()),
      RuleViolationError,
      "directory refuses new grants",
    );
    must(await after.access.revokeWarehouse(u.id, gone)); // but the stale grant can still go
    expect(must(await after.access.warehousesOf(u.id))).toEqual([]);
  });
});

describe("effective access", () => {
  it("combines roles and grants, and answers can()", async () => {
    const m = setup();
    const u = await addUser(m);
    expect(await m.accessFor(u.id)).toEqual(NO_ACCESS);

    must(await m.access.assignRole(u.id, "PICKER"));
    must(await m.access.grantWarehouse(u.id, WAREHOUSE));
    const access = await m.accessFor(u.id);
    expect(can(access, "inventory.read", WAREHOUSE)).toBe(true);
    expect(can(access, "inventory.read", randomUUID())).toBe(false);
    expect(can(access, "inventory.adjust", WAREHOUSE)).toBe(false);
    expect(can(access, "catalog.read")).toBe(true);
  });

  it("gives administrators every warehouse without grants", async () => {
    const m = setup();
    const u = await addUser(m);
    must(await m.access.assignRole(u.id, "ADMIN"));
    const access = await m.accessFor(u.id);
    expect(access.allWarehouses).toBe(true);
    expect(can(access, "inventory.adjust", randomUUID())).toBe(true);
  });

  it("gives a disabled or unknown user nothing", async () => {
    const m = setup();
    const [admin, u] = [await addUser(m), await addUser(m)];
    must(await m.access.assignRole(admin.id, "ADMIN"));
    must(await m.access.assignRole(u.id, "PICKER"));
    must(await m.users.update(u.id, { version: 1, status: "DISABLED" }));
    expect(await m.accessFor(u.id)).toEqual(NO_ACCESS);
    expect(await m.accessFor(randomUUID())).toEqual(NO_ACCESS);
  });
});
