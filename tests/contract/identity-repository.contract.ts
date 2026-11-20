import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdentityRepository } from "../../modules/identity/application/ports.js";
import { ConflictError, NotFoundError } from "../../modules/identity/domain/errors.js";
import type { UserAccount } from "../../modules/identity/domain/model.js";

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
  });
}
