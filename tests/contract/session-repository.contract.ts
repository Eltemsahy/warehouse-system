import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  IdentityRepository,
  SessionRepository,
} from "../../modules/identity/application/ports.js";
import type { UserAccount } from "../../modules/identity/domain/model.js";

interface Repos {
  sessions: SessionRepository;
  users: IdentityRepository;
}
type Factory = () => Repos | Promise<Repos>;

const uniq = () => randomUUID().slice(0, 8);
const at = (minutes: number) => new Date(Date.UTC(2026, 2, 1, 8, minutes));
const tokenHash = () => createHash("sha256").update(randomUUID()).digest("hex");

async function newUser({ users }: Repos): Promise<UserAccount> {
  const now = new Date();
  return users.insertUser(
    {
      id: randomUUID(),
      username: `user.${uniq()}`,
      email: null,
      displayName: "Test",
      status: "ACTIVE",
      locale: "en",
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      version: 1,
    },
    "scrypt$1024$8$1$c2FsdA==$aGFzaA==",
    "scrypt",
  );
}

async function newSession(repos: Repos, userId: string, issued = at(0), hours = 12) {
  const s = {
    id: randomUUID(),
    userId,
    tokenHash: tokenHash(),
    issuedAt: issued,
    expiresAt: new Date(issued.getTime() + hours * 3_600_000),
  };
  await repos.sessions.createSession(s);
  return s;
}

/** The SessionRepository contract (ADR 0006). Every adapter must pass this exact suite. */
export function sessionRepositoryContract(
  name: string,
  factory: Factory,
  opts: { skip?: boolean } = {},
) {
  const suite = opts.skip ? describe.skip : describe;

  suite(`SessionRepository contract: ${name}`, () => {
    it("stores a session and finds it by the hash of its token", async () => {
      const repos = await factory();
      const user = await newUser(repos);
      const s = await newSession(repos, user.id);
      expect(await repos.sessions.findSessionByTokenHash(s.tokenHash)).toEqual({
        id: s.id,
        userId: user.id,
        issuedAt: s.issuedAt,
        expiresAt: s.expiresAt,
        revokedAt: null,
      });
      expect(await repos.sessions.findSessionByTokenHash(tokenHash())).toBeNull();
    });

    it("revokes a session once", async () => {
      const repos = await factory();
      const user = await newUser(repos);
      const s = await newSession(repos, user.id);
      expect(await repos.sessions.revokeSession(s.id, at(5))).toBe(true);
      expect(await repos.sessions.revokeSession(s.id, at(6))).toBe(false);
      expect((await repos.sessions.findSessionByTokenHash(s.tokenHash))?.revokedAt).toEqual(at(5));
      expect(await repos.sessions.revokeSession(randomUUID(), at(5))).toBe(false);
    });

    it("revokes all of a user's live sessions, except one, and no one else's", async () => {
      const repos = await factory();
      const [a, b] = [await newUser(repos), await newUser(repos)];
      const [a1, a2, a3] = [
        await newSession(repos, a.id),
        await newSession(repos, a.id),
        await newSession(repos, a.id),
      ];
      const b1 = await newSession(repos, b.id);
      await repos.sessions.revokeSession(a3.id, at(1)); // already revoked: not counted again

      expect(await repos.sessions.revokeUserSessions(a.id, at(5), a1.id)).toBe(1);
      const state = async (s: { tokenHash: string }) =>
        (await repos.sessions.findSessionByTokenHash(s.tokenHash))?.revokedAt ?? null;
      expect(await state(a1)).toBeNull();
      expect(await state(a2)).toEqual(at(5));
      expect(await state(a3)).toEqual(at(1)); // keeps its original time
      expect(await state(b1)).toBeNull();
      expect(await repos.sessions.revokeUserSessions(a.id, at(6))).toBe(1); // a1, now
      expect(await repos.sessions.revokeUserSessions(a.id, at(7))).toBe(0);
    });

    it("counts failures per username inside the window, ignoring other usernames", async () => {
      const repos = await factory();
      const [mine, other] = [`name.${uniq()}`, `name.${uniq()}`];
      const record = (username: string, success: boolean, minutes: number) =>
        repos.sessions.recordLoginAttempt({ username, ip: null, success, at: at(minutes) });
      await record(mine, false, 0); // too old for the window below
      await record(mine, false, 10);
      await record(mine, false, 12);
      await record(mine, true, 11); // a success counts for nothing by itself
      await record(other, false, 12);
      // since minute 5, with a success at minute 11: only the failure at 12 comes after both
      expect(await repos.sessions.countUsernameFailures(mine, at(5))).toBe(1);
      expect(await repos.sessions.countUsernameFailures(other, at(5))).toBe(1);
      expect(await repos.sessions.countUsernameFailures(`name.${uniq()}`, at(0))).toBe(0);
    });

    it("lets a success reset the username count, but only the failures before it", async () => {
      const repos = await factory();
      const name = `name.${uniq()}`;
      const record = (success: boolean, minutes: number) =>
        repos.sessions.recordLoginAttempt({ username: name, ip: null, success, at: at(minutes) });
      await record(false, 1);
      await record(false, 2);
      expect(await repos.sessions.countUsernameFailures(name, at(0))).toBe(2);
      await record(true, 3);
      expect(await repos.sessions.countUsernameFailures(name, at(0))).toBe(0);
      await record(false, 4);
      expect(await repos.sessions.countUsernameFailures(name, at(0))).toBe(1);
    });

    it("counts failures per address, and a success does not reset them", async () => {
      const repos = await factory();
      const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
      const record = (
        username: string,
        success: boolean,
        minutes: number,
        address: string | null = ip,
      ) => repos.sessions.recordLoginAttempt({ username, ip: address, success, at: at(minutes) });
      await record(`a.${uniq()}`, false, 1);
      await record(`b.${uniq()}`, false, 2);
      await record(`c.${uniq()}`, true, 3); // someone else signs in from here: no reset
      await record(`d.${uniq()}`, false, 4, null); // no address: never counted against one
      expect(await repos.sessions.countIpFailures(ip, at(0))).toBe(2);
      expect(await repos.sessions.countIpFailures(ip, at(2))).toBe(1); // window start is inclusive
      expect(await repos.sessions.countIpFailures(ip, at(3))).toBe(0);
    });
  });
}
