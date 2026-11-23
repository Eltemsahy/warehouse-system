import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdentityRepository } from "../../modules/identity/application/ports.js";
import { ConflictError, NotFoundError } from "../../modules/identity/domain/errors.js";
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  type UserAccount,
} from "../../modules/identity/domain/model.js";

type RepoFactory = () => IdentityRepository | Promise<IdentityRepository>;

const uniq = () => randomUUID().slice(0, 8);

const user = (over: Partial<UserAccount> = {}): UserAccount => ({
  id: randomUUID(),
  username: `user.${uniq()}`,
  email: `${uniq()}@example.test`,
  displayName: "Test User",
  status: "ACTIVE",
  locale: "en",
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: null,
  updatedBy: null,
  version: 1,
  ...over,
});

const HASH = "scrypt$1024$8$1$c2FsdA==$aGFzaA==";

/**
 * The IdentityRepository contract (Implementation Plan P1-1). Every adapter must pass this exact
 * suite.
 */
export function identityRepositoryContract(
  name: string,
  factory: RepoFactory,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`IdentityRepository contract: ${name}`, () => {
    it("stores a user with a credential and reads both back", async () => {
      const repo = await factory();
      const u = user({ locale: "ar-EG" });
      const stored = await repo.insertUser(u, HASH, "scrypt");
      expect(stored).toMatchObject({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: "Test User",
        status: "ACTIVE",
        locale: "ar-EG",
        version: 1,
      });
      expect((await repo.getUser(u.id))?.username).toBe(u.username);
      const credential = await repo.getCredential(u.id);
      expect(credential).toMatchObject({ userId: u.id, passwordHash: HASH, algorithm: "scrypt" });
    });

    it("never returns the password hash with the account", async () => {
      const repo = await factory();
      const stored = await repo.insertUser(user(), HASH, "scrypt");
      expect(JSON.stringify(stored)).not.toContain("scrypt$");
      expect(JSON.stringify(await repo.getUser(stored.id))).not.toContain("scrypt$");
    });

    it("finds a user by username ignoring case, and returns null for unknown ones", async () => {
      const repo = await factory();
      const u = await repo.insertUser(user({ username: `Mixed.${uniq()}` }), HASH, "scrypt");
      expect((await repo.getUserByUsername(u.username.toUpperCase()))?.id).toBe(u.id);
      expect(await repo.getUserByUsername("nobody.at.all")).toBeNull();
      expect(await repo.getUser(randomUUID())).toBeNull();
      expect(await repo.getCredential(randomUUID())).toBeNull();
    });

    it("rejects a duplicate username or email, ignoring case, and stores nothing", async () => {
      const repo = await factory();
      const u = await repo.insertUser(
        user({ username: `Dup.${uniq()}`, email: `Dup.${uniq()}@Example.test` }),
        HASH,
        "scrypt",
      );
      await expect(
        repo.insertUser(user({ username: u.username.toUpperCase() }), HASH, "scrypt"),
      ).rejects.toBeInstanceOf(ConflictError);
      const clash = user({ email: (u.email ?? "").toUpperCase() });
      await expect(repo.insertUser(clash, HASH, "scrypt")).rejects.toBeInstanceOf(ConflictError);
      expect(await repo.getUser(clash.id)).toBeNull();
      expect(await repo.getCredential(clash.id)).toBeNull();
    });

    it("lets many users have no email", async () => {
      const repo = await factory();
      await repo.insertUser(user({ email: null }), HASH, "scrypt");
      await expect(repo.insertUser(user({ email: null }), HASH, "scrypt")).resolves.toMatchObject({
        email: null,
      });
    });

    it("updates the profile and bumps the version, never changing the username", async () => {
      const repo = await factory();
      const u = await repo.insertUser(user(), HASH, "scrypt");
      const updated = await repo.updateUser(
        {
          ...u,
          displayName: "Renamed",
          email: null,
          status: "DISABLED",
          locale: "fr",
          username: "hacked.name",
        },
        1,
      );
      expect(updated).toMatchObject({
        username: u.username,
        displayName: "Renamed",
        email: null,
        status: "DISABLED",
        locale: "fr",
        version: 2,
      });
    });

    it("rejects a stale version, an unknown user, and an email already in use on update", async () => {
      const repo = await factory();
      const [a, b] = [
        await repo.insertUser(user(), HASH, "scrypt"),
        await repo.insertUser(user(), HASH, "scrypt"),
      ];
      await repo.updateUser({ ...a, displayName: "First" }, 1);
      await expect(repo.updateUser({ ...a, displayName: "Late" }, 1)).rejects.toBeInstanceOf(
        ConflictError,
      );
      await expect(repo.updateUser({ ...a, id: randomUUID() }, 1)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(repo.updateUser({ ...b, email: a.email }, 1)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });

    it("changes a password and records when", async () => {
      const repo = await factory();
      const u = await repo.insertUser(user(), HASH, "scrypt");
      const before = await repo.getCredential(u.id);
      await repo.setPassword(u.id, "scrypt$2048$8$1$c2FsdA==$bmV3", "scrypt");
      const after = await repo.getCredential(u.id);
      expect(after?.passwordHash).toBe("scrypt$2048$8$1$c2FsdA==$bmV3");
      expect((after?.changedAt.getTime() ?? 0) >= (before?.changedAt.getTime() ?? 1)).toBe(true);
      await expect(repo.setPassword(randomUUID(), HASH, "scrypt")).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("lists in username order with keyset pagination and a status filter", async () => {
      const repo = await factory();
      const p = `list${uniq()}`;
      for (const n of ["c", "a", "b", "d"])
        await repo.insertUser(user({ username: `${p}.${n}` }), HASH, "scrypt");
      const d = await repo.getUserByUsername(`${p}.d`);
      if (d) await repo.updateUser({ ...d, status: "DISABLED" }, 1);

      const mine = async (f: Parameters<IdentityRepository["listUsers"]>[0]) =>
        (await repo.listUsers(f)).items.map((x) => x.username).filter((x) => x.startsWith(p));
      expect(await mine({ limit: 500 })).toEqual([`${p}.a`, `${p}.b`, `${p}.c`, `${p}.d`]);
      expect(await mine({ limit: 500, status: "DISABLED" })).toEqual([`${p}.d`]);

      const page1 = await repo.listUsers({ limit: 2, after: `${p}.` });
      expect(page1.items.map((x) => x.username)).toEqual([`${p}.a`, `${p}.b`]);
      expect(page1.nextAfter).toBe(`${p}.b`);
      const page2 = await repo.listUsers({ limit: 2, after: page1.nextAfter ?? "" });
      expect(page2.items.map((x) => x.username).slice(0, 2)).toEqual([`${p}.c`, `${p}.d`]);
    });

    // ---- roles and warehouse access (ADR 0005)

    const byCode = <T extends { code: string }>(a: T, b: T) => (a.code < b.code ? -1 : 1);
    const newUser = async (repo: IdentityRepository, over: Partial<UserAccount> = {}) =>
      repo.insertUser(user(over), HASH, "scrypt");

    it("has the roles and permissions the domain declares, nothing more or less", async () => {
      const repo = await factory();
      expect(await repo.listRoles()).toEqual(SYSTEM_ROLES);
      expect(await repo.listPermissions()).toEqual([...PERMISSIONS].sort(byCode));
    });

    it("assigns roles idempotently, lists them sorted and removes them", async () => {
      const repo = await factory();
      const u = await newUser(repo);
      expect(await repo.listUserRoles(u.id)).toEqual([]);
      await repo.assignRole(u.id, "PICKER");
      await repo.assignRole(u.id, "ADMIN");
      await repo.assignRole(u.id, "PICKER"); // again: no error, no duplicate
      expect(await repo.listUserRoles(u.id)).toEqual(["ADMIN", "PICKER"]);
      expect(await repo.removeRole(u.id, "PICKER")).toBe(true);
      expect(await repo.removeRole(u.id, "PICKER")).toBe(false);
      expect(await repo.removeRole(randomUUID(), "PICKER")).toBe(false);
      expect(await repo.listUserRoles(u.id)).toEqual(["ADMIN"]);
    });

    it("refuses to assign an unknown role or to an unknown user", async () => {
      const repo = await factory();
      const u = await newUser(repo);
      await expect(repo.assignRole(u.id, "NO_SUCH_ROLE")).rejects.toBeInstanceOf(NotFoundError);
      await expect(repo.assignRole(randomUUID(), "PICKER")).rejects.toBeInstanceOf(NotFoundError);
    });

    it("grants and revokes warehouse access idempotently, sorted", async () => {
      const repo = await factory();
      const u = await newUser(repo);
      const [w1, w2] = [randomUUID(), randomUUID()].sort();
      await repo.grantWarehouse(u.id, w2 as string);
      await repo.grantWarehouse(u.id, w1 as string);
      await repo.grantWarehouse(u.id, w1 as string);
      expect(await repo.listWarehouseAccess(u.id)).toEqual([w1, w2]);
      expect(await repo.revokeWarehouse(u.id, w1 as string)).toBe(true);
      expect(await repo.revokeWarehouse(u.id, w1 as string)).toBe(false);
      expect(await repo.listWarehouseAccess(u.id)).toEqual([w2]);
      await expect(repo.grantWarehouse(randomUUID(), w1 as string)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("works out effective access from every role and grant", async () => {
      const repo = await factory();
      const u = await newUser(repo);
      expect(await repo.getAccess(u.id)).toEqual({
        permissions: [],
        allWarehouses: false,
        warehouseIds: [],
      });

      await repo.assignRole(u.id, "PICKER");
      await repo.assignRole(u.id, "PUTAWAY_OPERATOR");
      const w = randomUUID();
      await repo.grantWarehouse(u.id, w);
      const expected = [
        ...new Set(
          SYSTEM_ROLES.filter((r) => ["PICKER", "PUTAWAY_OPERATOR"].includes(r.code)).flatMap(
            (r) => r.permissions,
          ),
        ),
      ].sort();
      expect(await repo.getAccess(u.id)).toEqual({
        permissions: expected,
        allWarehouses: false,
        warehouseIds: [w],
      });

      await repo.assignRole(u.id, "ADMIN");
      const admin = await repo.getAccess(u.id);
      expect(admin.allWarehouses).toBe(true);
      expect(admin.permissions).toEqual(PERMISSIONS.map((p) => p.code).sort());
    });

    it("counts the other active holders of a role", async () => {
      const repo = await factory();
      const [a, b] = [await newUser(repo), await newUser(repo)];
      const base = await repo.otherActiveHolders("PACKER", randomUUID()); // others may hold it already
      await repo.assignRole(a.id, "PACKER");
      await repo.assignRole(b.id, "PACKER");
      expect(await repo.otherActiveHolders("PACKER", randomUUID())).toBe(base + 2);
      expect(await repo.otherActiveHolders("PACKER", a.id)).toBe(base + 1);
      await repo.updateUser({ ...b, status: "DISABLED" }, 1); // a disabled holder does not count
      expect(await repo.otherActiveHolders("PACKER", a.id)).toBe(base);
    });
  });
}
