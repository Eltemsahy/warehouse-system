import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import {
  createIdentityModule,
  InMemoryIdentityRepository,
  ScryptPasswordHasher,
} from "../../modules/identity/index.js";
import {
  ConflictError,
  NotFoundError,
  RuleViolationError,
} from "../../modules/identity/domain/errors.js";

const hasher = new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 }); // cheap, for speed

function setup() {
  const repository = new InMemoryIdentityRepository();
  return { repository, ...createIdentityModule({ repository, hasher }) };
}

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

const valid = {
  username: "jane.doe",
  displayName: "Jane Doe",
  email: "jane@example.test",
  password: "a long enough passphrase",
};

describe("users", () => {
  it("creates an active user whose password is stored hashed", async () => {
    const m = setup();
    const u = must(await m.users.create(valid));
    expect(u).toMatchObject({
      username: "jane.doe",
      displayName: "Jane Doe",
      email: "jane@example.test",
      status: "ACTIVE",
      locale: "en",
      version: 1,
    });
    const credential = await m.repository.getCredential(u.id);
    expect(credential?.passwordHash).not.toContain(valid.password);
    expect(await hasher.verify(valid.password, credential?.passwordHash ?? "")).toBe(true);
    expect(credential?.algorithm).toBe("scrypt");
  });

  it("enforces its rules on create", async () => {
    const m = setup();
    const bad = async (over: Partial<typeof valid> & { locale?: string }, label: string) =>
      expectError(await m.users.create({ ...valid, ...over }), RuleViolationError, label);
    await bad({ username: "ab" }, "short username");
    await bad({ username: "has space" }, "username format");
    await bad({ email: "not-an-email" }, "email");
    await bad({ displayName: "   " }, "blank name");
    await bad({ locale: "English" }, "locale");
    await bad({ password: "short" }, "short password");
    await bad({ password: "JANE.DOE", username: "jane.doe" }, "short and the username");
    await bad({ username: "janedoe.long", password: "JaneDoe.Long" }, "password equals username");
    expect((await m.users.list({ limit: 10 })).items).toEqual([]); // nothing was stored
  });

  it("refuses a taken username or email, ignoring case", async () => {
    const m = setup();
    must(await m.users.create(valid));
    expectError(
      await m.users.create({ ...valid, username: "JANE.DOE", email: null }),
      ConflictError,
      "username",
    );
    expectError(
      await m.users.create({ ...valid, username: "other.person", email: "JANE@EXAMPLE.TEST" }),
      ConflictError,
      "email",
    );
  });

  it("gets a user and says when there is none", async () => {
    const m = setup();
    const u = must(await m.users.create(valid));
    expect(must(await m.users.get(u.id)).username).toBe("jane.doe");
    expectError(await m.users.get("00000000-0000-4000-8000-000000000000"), NotFoundError);
  });

  it("lists in username order, pages and filters by status", async () => {
    const m = setup();
    for (const n of ["carol", "alice", "bob"]) {
      must(await m.users.create({ ...valid, username: n, email: null }));
    }
    const bob = must(await m.users.get((await m.users.list({ limit: 10 })).items[1]?.id ?? ""));
    must(await m.users.update(bob.id, { version: bob.version, status: "DISABLED" }));

    const all = await m.users.list({ limit: 10 });
    expect(all.items.map((x) => x.username)).toEqual(["alice", "bob", "carol"]);
    expect(all.nextAfter).toBeNull();
    const first = await m.users.list({ limit: 2 });
    expect(first.items.map((x) => x.username)).toEqual(["alice", "bob"]);
    expect(first.nextAfter).toBe("bob");
    expect((await m.users.list({ limit: 2, after: "bob" })).items.map((x) => x.username)).toEqual([
      "carol",
    ]);
    expect(
      (await m.users.list({ limit: 10, status: "DISABLED" })).items.map((x) => x.username),
    ).toEqual(["bob"]);
  });

  it("updates the profile, disables and re-enables, and bumps the version", async () => {
    const m = setup();
    const u = must(await m.users.create(valid));
    const renamed = must(
      await m.users.update(u.id, {
        version: 1,
        displayName: "  Jane D.  ",
        locale: "ar-EG",
        email: null,
      }),
    );
    expect(renamed).toMatchObject({
      displayName: "Jane D.",
      locale: "ar-EG",
      email: null,
      version: 2,
    });
    const off = must(await m.users.update(u.id, { version: 2, status: "DISABLED" }));
    expect(off.status).toBe("DISABLED");
    expect(must(await m.users.update(u.id, { version: 3, status: "ACTIVE" })).status).toBe(
      "ACTIVE",
    );
  });

  it("enforces its rules on update", async () => {
    const m = setup();
    const u = must(await m.users.create(valid));
    const other = must(
      await m.users.create({ ...valid, username: "john.roe", email: "john@example.test" }),
    );
    expectError(
      await m.users.update(u.id, { version: 1, email: "nope" }),
      RuleViolationError,
      "email",
    );
    expectError(
      await m.users.update(u.id, { version: 1, displayName: "" }),
      RuleViolationError,
      "name",
    );
    expectError(
      await m.users.update(u.id, { version: 1, locale: "xx-yy" }),
      RuleViolationError,
      "locale",
    );
    expectError(
      await m.users.update(u.id, { version: 1, status: "LOCKED" as never }),
      RuleViolationError,
      "status",
    );
    expectError(
      await m.users.update(u.id, { version: 1, email: other.email }),
      ConflictError,
      "email in use",
    );
    must(await m.users.update(u.id, { version: 1, displayName: "First" }));
    expectError(
      await m.users.update(u.id, { version: 1, displayName: "Late" }),
      ConflictError,
      "stale",
    );
    expectError(
      await m.users.update("00000000-0000-4000-8000-000000000000", {
        version: 1,
        displayName: "X",
      }),
      NotFoundError,
      "unknown",
    );
  });

  it("resets a password: the new one works, the old one does not, and the policy applies", async () => {
    const m = setup();
    const u = must(await m.users.create(valid));
    expectError(await m.users.setPassword(u.id, "short"), RuleViolationError, "policy");
    expectError(await m.users.setPassword(u.id, "JANE.DOE"), RuleViolationError, "policy");
    expectError(
      await m.users.setPassword("00000000-0000-4000-8000-000000000000", "another long passphrase"),
      NotFoundError,
    );

    must(await m.users.setPassword(u.id, "another long passphrase"));
    const stored = (await m.repository.getCredential(u.id))?.passwordHash ?? "";
    expect(await hasher.verify("another long passphrase", stored)).toBe(true);
    expect(await hasher.verify(valid.password, stored)).toBe(false);
  });
});
