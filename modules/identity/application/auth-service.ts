import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import {
  AuthenticationError,
  NotFoundError,
  TooManyAttemptsError,
  type IdentityError,
} from "../domain/errors.js";
import { passwordProblem, type Principal, type UserAccount } from "../domain/model.js";
import type { IdentityRepository, PasswordHasher, SessionRepository } from "./ports.js";
import { generateToken, hashToken, TOKEN_PATTERN } from "./tokens.js";
import { violation } from "./support.js";

export interface AuthOptions {
  /** How long a session lasts, from login. Default 12 hours: one shift. */
  sessionTtlMs?: number;
  /** Failed attempts are counted over this window. Default 15 minutes. */
  windowMs?: number;
  /** Failures for one username in the window before it is locked out. Default 5. */
  maxUsernameFailures?: number;
  /** Failures from one address in the window before it is locked out. Default 20. */
  maxIpFailures?: number;
}

export interface LoginInput {
  username: string;
  password: string;
  /** The caller's address, for the per-address limit. */
  ip?: string | null;
}

export interface LoginResult {
  /** Shown once. Only its hash is kept. */
  token: string;
  expiresAt: Date;
  user: UserAccount;
}

/** Usernames are matched without case, so the attempts are counted without case too. */
const attemptKey = (username: string) => username.trim().toLowerCase().slice(0, 100);

/**
 * Login, sessions and password change for the signed-in user (ADR 0006).
 *
 * Sessions are opaque random tokens kept as hashes, so disabling a user or logging out takes
 * effect on the very next request. A wrong password, an unknown user and a disabled account all
 * answer the same way, after the same work. Failed attempts are limited per username (a success
 * resets it) and per address (a success does not).
 */
export class AuthService {
  private readonly sessionTtlMs: number;
  private readonly windowMs: number;
  private readonly maxUsernameFailures: number;
  private readonly maxIpFailures: number;
  private dummy: Promise<string> | undefined;

  constructor(
    private users: IdentityRepository,
    private sessions: SessionRepository,
    private hasher: PasswordHasher,
    options: AuthOptions = {},
    private clock: () => Date = () => new Date(),
  ) {
    this.sessionTtlMs = options.sessionTtlMs ?? 12 * 60 * 60 * 1000;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.maxUsernameFailures = options.maxUsernameFailures ?? 5;
    this.maxIpFailures = options.maxIpFailures ?? 20;
  }

  async login(i: LoginInput): Promise<Result<LoginResult, IdentityError>> {
    const now = this.clock();
    const key = attemptKey(i.username);
    const ip = i.ip ?? null;

    const blocked = await this.blocked(key, ip, now);
    if (blocked) return err(blocked);

    const user = await this.users.getUserByUsername(i.username);
    const credential = user ? await this.users.getCredential(user.id) : null;
    // An unknown user costs the same work as a known one, so timing does not give them away.
    const stored = credential?.passwordHash ?? (await this.dummyHash());
    const valid = await this.hasher.verify(i.password, stored);

    if (!user || !credential || !valid || user.status !== "ACTIVE") {
      await this.sessions.recordLoginAttempt({ username: key, ip, success: false, at: now });
      return err(new AuthenticationError());
    }

    if (this.hasher.needsRehash(stored)) {
      await this.users.setPassword(
        user.id,
        await this.hasher.hash(i.password),
        this.hasher.algorithm,
      );
    }
    await this.sessions.recordLoginAttempt({ username: key, ip, success: true, at: now });

    const token = generateToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs);
    await this.sessions.createSession({
      id: newId(),
      userId: user.id,
      tokenHash: hashToken(token),
      issuedAt: now,
      expiresAt,
    });
    return ok({ token, expiresAt, user });
  }

  /** Who is calling? Null for anything that is not a live session of an active user. */
  async authenticate(token: string): Promise<Principal | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const session = await this.sessions.findSessionByTokenHash(hashToken(token));
    if (!session || session.revokedAt !== null || session.expiresAt <= this.clock()) return null;
    const user = await this.users.getUser(session.userId);
    if (!user || user.status !== "ACTIVE") return null;
    return {
      userId: user.id,
      username: user.username,
      sessionId: session.id,
      expiresAt: session.expiresAt,
      access: await this.users.getAccess(user.id),
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revokeSession(sessionId, this.clock());
  }

  /** Ends every session of a user: a forced sign-out. */
  async revokeSessions(userId: string): Promise<Result<null, IdentityError>> {
    if (!(await this.users.getUser(userId))) return err(new NotFoundError("user"));
    await this.sessions.revokeUserSessions(userId, this.clock());
    return ok(null);
  }

  /**
   * The signed-in user changes their own password. The current one must be right (and counts
   * against the attempt limits, so a stolen session cannot be used to guess it). Every other
   * session of the user ends; this one stays.
   */
  async changePassword(
    who: Principal,
    input: { currentPassword: string; newPassword: string },
    ip: string | null = null,
  ): Promise<Result<null, IdentityError>> {
    const now = this.clock();
    const key = attemptKey(who.username);
    const blocked = await this.blocked(key, ip, now);
    if (blocked) return err(blocked);

    const credential = await this.users.getCredential(who.userId);
    const valid =
      credential !== null &&
      (await this.hasher.verify(input.currentPassword, credential.passwordHash));
    await this.sessions.recordLoginAttempt({ username: key, ip, success: valid, at: now });
    if (!valid) return violation("the current password is incorrect");

    const problem =
      passwordProblem(input.newPassword, who.username) ??
      (input.newPassword === input.currentPassword
        ? "the new password must differ from the current one"
        : undefined);
    if (problem) return violation(problem);

    await this.users.setPassword(
      who.userId,
      await this.hasher.hash(input.newPassword),
      this.hasher.algorithm,
    );
    await this.sessions.revokeUserSessions(who.userId, now, who.sessionId);
    return ok(null);
  }

  private async blocked(key: string, ip: string | null, now: Date) {
    const since = new Date(now.getTime() - this.windowMs);
    const locked =
      (await this.sessions.countUsernameFailures(key, since)) >= this.maxUsernameFailures ||
      (ip !== null && (await this.sessions.countIpFailures(ip, since)) >= this.maxIpFailures);
    // The whole window is an upper bound: the oldest failure ages out sooner than that.
    return locked ? new TooManyAttemptsError(Math.ceil(this.windowMs / 1000)) : undefined;
  }

  private dummyHash(): Promise<string> {
    this.dummy ??= this.hasher.hash(newId());
    return this.dummy;
  }
}
