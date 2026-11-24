import { describe, expect, it } from "vitest";
import type { Result } from "../../shared/kernel/index.js";
import {
  createIdentityModule,
  InMemoryIdentityRepository,
  InMemorySessionRepository,
  NO_ACCESS,
  ScryptPasswordHasher,
  type AuthOptions,
} from "../../modules/identity/index.js";
import {
  AuthenticationError,
  NotFoundError,
  RuleViolationError,
  TooManyAttemptsError,
} from "../../modules/identity/domain/errors.js";
import { hashToken } from "../../modules/identity/application/tokens.js";

const cheap = new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 });
const PASSWORD = "a long enough passphrase";
const START = new Date("2026-03-01T08:00:00Z");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

function setup(options: AuthOptions = {}, hasher: ScryptPasswordHasher = cheap) {
  const clock = { now: START };
  const repository = new InMemoryIdentityRepository();
  const sessions = new InMemorySessionRepository();
  const m = createIdentityModule({
    repository,
    sessions,
    hasher,
    auth: options,
    clock: () => clock.now,
  });
  return {
    ...m,
    repository,
    sessions,
    advance: (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
  };
}
type World = ReturnType<typeof setup>;

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

const addUser = async (w: World, username = "jane.doe") =>
  must(await w.users.create({ username, displayName: "Jane", password: PASSWORD }));

/** Signs in and, unless told otherwise, lets one second pass so attempts never share an instant. */
async function login(w: World, username: string, password: string, ip: string | null = null) {
  const result = await w.auth.login({ username, password, ip });
  w.advance(SECOND);
  return result;
}

describe("login", () => {
  it("returns a token that identifies the user, and expires with the session", async () => {
    const w = setup();
    const u = await addUser(w);
    must(await w.access.assignRole(u.id, "PICKER"));
    const { token, expiresAt, user } = must(await login(w, "jane.doe", PASSWORD));

    expect(/^wms_[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
    expect(user.username).toBe("jane.doe");
    expect(expiresAt).toEqual(new Date(START.getTime() + 12 * HOUR));
    const who = await w.authenticate(token);
    expect(who).toMatchObject({ userId: u.id, username: "jane.doe", expiresAt });
    expect(who?.access.permissions).toContain("inventory.read");
    expect(who?.access.permissions).not.toContain("inventory.adjust");
  });

  it("gives every login its own token and keeps only a hash of it", async () => {
    const w = setup();
    await addUser(w);
    const [a, b] = [
      must(await login(w, "jane.doe", PASSWORD)),
      must(await login(w, "jane.doe", PASSWORD)),
    ];
    expect(a.token).not.toBe(b.token);
    expect(await w.sessions.findSessionByTokenHash(a.token)).toBeNull();
    expect(await w.sessions.findSessionByTokenHash(hashToken(a.token))).not.toBeNull();
  });

  it("ignores the case of the username", async () => {
    const w = setup();
    await addUser(w);
    must(await login(w, "JANE.DOE", PASSWORD));
  });

  it("answers a wrong password, an unknown user and a disabled user in the same way", async () => {
    const w = setup();
    const u = await addUser(w);
    const disabled = await addUser(w, "john.roe");
    must(await w.users.update(disabled.id, { version: 1, status: "DISABLED" }));

    const results = [
      await login(w, "jane.doe", "not the password"),
      await login(w, "nobody.here", "not the password"),
      await login(w, "john.roe", PASSWORD), // right password, disabled account
    ];
    for (const r of results) expectError(r, AuthenticationError);
    const messages = results.map((r) => (r.ok ? "" : r.error.message));
    expect(new Set(messages).size).toBe(1);
    expect(u.status).toBe("ACTIVE");
  });

  it("locks a username out after too many failures, even for the right password", async () => {
    const w = setup();
    await addUser(w);
    for (let i = 0; i < 5; i++)
      expectError(await login(w, "jane.doe", "wrong password"), AuthenticationError);

    const locked = await login(w, "jane.doe", PASSWORD);
    expectError(locked, TooManyAttemptsError);
    if (!locked.ok && locked.error instanceof TooManyAttemptsError) {
      expect(locked.error.retryAfterSeconds).toBe(15 * 60);
    }
    expect((await login(w, "someone.else", "wrong password")).ok).toBe(false);
    expectError(await login(w, "someone.else", "wrong password"), AuthenticationError); // not locked
  });

  it("lets the lock lapse once the failures leave the window", async () => {
    const w = setup();
    await addUser(w);
    for (let i = 0; i < 5; i++) await login(w, "jane.doe", "wrong password");
    // Attempts made while locked are not recorded, so they cannot extend the lock.
    for (let i = 0; i < 3; i++)
      expectError(await login(w, "jane.doe", PASSWORD), TooManyAttemptsError);
    w.advance(15 * MINUTE + 5 * SECOND);
    must(await login(w, "jane.doe", PASSWORD));
  });

  it("resets the username count after a successful login", async () => {
    const w = setup();
    await addUser(w);
    for (let i = 0; i < 4; i++) await login(w, "jane.doe", "wrong password");
    must(await login(w, "jane.doe", PASSWORD));
    for (let i = 0; i < 5; i++)
      expectError(await login(w, "jane.doe", "wrong password"), AuthenticationError);
    expectError(await login(w, "jane.doe", "wrong password"), TooManyAttemptsError);
  });

  it("limits failures per address across usernames, and a success does not reset them", async () => {
    const w = setup({ maxIpFailures: 3 });
    await addUser(w);
    const ip = "203.0.113.7";
    await login(w, "ghost.one", "x", ip);
    must(await login(w, "jane.doe", PASSWORD, ip)); // a success from the same address
    await login(w, "ghost.two", "x", ip);
    await login(w, "ghost.three", "x", ip);

    expectError(await login(w, "jane.doe", PASSWORD, ip), TooManyAttemptsError);
    must(await login(w, "jane.doe", PASSWORD, "203.0.113.8")); // another address is fine
    must(await login(w, "jane.doe", PASSWORD, null)); // no address known: only the username limit applies
  });

  it("rehashes a password made with weaker settings", async () => {
    const weak = setup();
    const u = await addUser(weak);
    const stronger = new ScryptPasswordHasher({ N: 2 ** 11, r: 8, p: 1 });
    const strong = createIdentityModule({
      repository: weak.repository,
      sessions: weak.sessions,
      hasher: stronger,
    });
    expect(
      (await weak.repository.getCredential(u.id))?.passwordHash.startsWith("scrypt$1024$"),
    ).toBe(true);

    must(await strong.auth.login({ username: "jane.doe", password: PASSWORD }));
    expect(
      (await weak.repository.getCredential(u.id))?.passwordHash.startsWith("scrypt$2048$"),
    ).toBe(true);
    must(await strong.auth.login({ username: "jane.doe", password: PASSWORD })); // still works
  });
});

describe("sessions", () => {
  it("refuses tokens that are malformed or unknown", async () => {
    const w = setup();
    await addUser(w);
    must(await login(w, "jane.doe", PASSWORD));
    for (const bad of [
      "",
      "abc",
      "wms_",
      `wms_${"A".repeat(43)}`,
      `wms_${"A".repeat(44)}`,
      "Bearer x",
    ]) {
      expect(await w.authenticate(bad), bad).toBeNull();
    }
  });

  it("expires after the session lifetime", async () => {
    const w = setup({ sessionTtlMs: 2 * HOUR });
    await addUser(w);
    const { token } = must(await w.auth.login({ username: "jane.doe", password: PASSWORD }));
    w.advance(2 * HOUR - SECOND);
    expect(await w.authenticate(token)).not.toBeNull();
    w.advance(SECOND);
    expect(await w.authenticate(token)).toBeNull();
  });

  it("ends on logout, leaving the user's other sessions alone", async () => {
    const w = setup();
    await addUser(w);
    const [a, b] = [
      must(await login(w, "jane.doe", PASSWORD)),
      must(await login(w, "jane.doe", PASSWORD)),
    ];
    const who = await w.authenticate(a.token);
    await w.auth.logout(who?.sessionId ?? "");
    expect(await w.authenticate(a.token)).toBeNull();
    expect(await w.authenticate(b.token)).not.toBeNull();
  });

  it("ends when the user is disabled, and does not come back when they are enabled again", async () => {
    const w = setup();
    const u = await addUser(w);
    const { token } = must(await login(w, "jane.doe", PASSWORD));

    must(await w.users.update(u.id, { version: 1, status: "DISABLED" }));
    expect(await w.authenticate(token)).toBeNull();
    must(await w.users.update(u.id, { version: 2, status: "ACTIVE" }));
    expect(await w.authenticate(token)).toBeNull(); // the old session stays dead
    expect(must(await login(w, "jane.doe", PASSWORD)).token).not.toBe(token);
  });

  it("ends when an administrator resets the password", async () => {
    const w = setup();
    const u = await addUser(w);
    const { token } = must(await login(w, "jane.doe", PASSWORD));
    must(await w.users.setPassword(u.id, "another long passphrase"));
    expect(await w.authenticate(token)).toBeNull();
    expectError(await login(w, "jane.doe", PASSWORD), AuthenticationError);
    must(await login(w, "jane.doe", "another long passphrase"));
  });

  it("can be ended for a whole user at once", async () => {
    const w = setup();
    const u = await addUser(w);
    const [a, b] = [
      must(await login(w, "jane.doe", PASSWORD)),
      must(await login(w, "jane.doe", PASSWORD)),
    ];
    must(await w.auth.revokeSessions(u.id));
    expect(await w.authenticate(a.token)).toBeNull();
    expect(await w.authenticate(b.token)).toBeNull();
    expectError(await w.auth.revokeSessions("00000000-0000-4000-8000-000000000000"), NotFoundError);
  });

  it("sees role changes straight away", async () => {
    const w = setup();
    const u = await addUser(w);
    const { token } = must(await login(w, "jane.doe", PASSWORD));
    expect((await w.authenticate(token))?.access).toEqual(NO_ACCESS);
    must(await w.access.assignRole(u.id, "ADMIN"));
    expect((await w.authenticate(token))?.access.allWarehouses).toBe(true);
  });
});

describe("changing your own password", () => {
  async function signedIn(w: World) {
    const { token } = must(await login(w, "jane.doe", PASSWORD));
    const who = await w.authenticate(token);
    if (!who) throw new Error("expected a live session");
    return { token, who };
  }

  it("needs the current password, which counts against the attempt limit", async () => {
    const w = setup();
    await addUser(w);
    const { who } = await signedIn(w);
    for (let i = 0; i < 5; i++) {
      expectError(
        await w.auth.changePassword(who, {
          currentPassword: "wrong",
          newPassword: "a brand new passphrase",
        }),
        RuleViolationError,
      );
      w.advance(SECOND);
    }
    expectError(
      await w.auth.changePassword(who, {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase",
      }),
      TooManyAttemptsError,
    );
  });

  it("applies the password policy and refuses an unchanged password", async () => {
    const w = setup();
    await addUser(w);
    const { who } = await signedIn(w);
    for (const newPassword of ["short", "JANE.DOE", PASSWORD]) {
      expectError(
        await w.auth.changePassword(who, { currentPassword: PASSWORD, newPassword }),
        RuleViolationError,
        newPassword,
      );
      w.advance(SECOND);
    }
  });

  it("switches to the new password and ends the user's other sessions, not this one", async () => {
    const w = setup();
    await addUser(w);
    const [mine, other] = [await signedIn(w), await signedIn(w)];
    must(
      await w.auth.changePassword(mine.who, {
        currentPassword: PASSWORD,
        newPassword: "a brand new passphrase",
      }),
    );

    expect(await w.authenticate(mine.token)).not.toBeNull();
    expect(await w.authenticate(other.token)).toBeNull();
    expectError(await login(w, "jane.doe", PASSWORD), AuthenticationError);
    must(await login(w, "jane.doe", "a brand new passphrase"));
  });
});
