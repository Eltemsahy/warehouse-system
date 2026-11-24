import { err, newId, ok, type Result } from "../../../shared/kernel/index.js";
import { NotFoundError, type IdentityError } from "../domain/errors.js";
import {
  passwordProblem,
  USER_STATUSES,
  type UserAccount,
  type UserStatus,
} from "../domain/model.js";
import type {
  IdentityRepository,
  PasswordHasher,
  SessionRepository,
  UserFilter,
  UserPage,
} from "./ports.js";
import {
  attempt,
  emailProblem,
  isLastActiveAdmin,
  localeProblem,
  newAudit,
  textProblem,
  usernameProblem,
  violation,
} from "./support.js";

export interface CreateUserInput {
  username: string;
  email?: string | null;
  displayName: string;
  password: string;
  /** Defaults to "en". */
  locale?: string;
}

export interface UpdateUserInput {
  /** The version the caller last read. */
  version: number;
  email?: string | null;
  displayName?: string;
  locale?: string;
  status?: UserStatus;
}

/**
 * User accounts. Passwords are checked against the policy, hashed here and never returned: the
 * repository hands back accounts without the hash. Login, roles and route protection come in
 * later steps, so nothing here knows who is calling yet.
 */
export class UserService {
  constructor(
    private repo: IdentityRepository,
    private hasher: PasswordHasher,
    /** When given, disabling a user or resetting their password ends their sessions. */
    private sessions?: SessionRepository,
  ) {}

  async create(i: CreateUserInput): Promise<Result<UserAccount, IdentityError>> {
    const locale = i.locale ?? "en";
    const problem =
      usernameProblem(i.username) ??
      emailProblem(i.email) ??
      textProblem("display name", i.displayName, 120) ??
      localeProblem(locale) ??
      passwordProblem(i.password, i.username);
    if (problem) return violation(problem);

    const passwordHash = await this.hasher.hash(i.password);
    const account: UserAccount = {
      id: newId(),
      username: i.username,
      email: i.email ?? null,
      displayName: i.displayName.trim(),
      status: "ACTIVE",
      locale,
      ...newAudit(),
    };
    return attempt(() => this.repo.insertUser(account, passwordHash, this.hasher.algorithm));
  }

  async get(id: string): Promise<Result<UserAccount, IdentityError>> {
    const user = await this.repo.getUser(id);
    return user ? ok(user) : err(new NotFoundError("user"));
  }

  list(filter: UserFilter): Promise<UserPage> {
    return this.repo.listUsers(filter);
  }

  async update(id: string, i: UpdateUserInput): Promise<Result<UserAccount, IdentityError>> {
    const current = await this.repo.getUser(id);
    if (!current) return err(new NotFoundError("user"));

    const next: UserAccount = { ...current };
    if (i.email !== undefined) next.email = i.email;
    if (i.displayName !== undefined) next.displayName = i.displayName.trim();
    if (i.locale !== undefined) next.locale = i.locale;
    if (i.status !== undefined) next.status = i.status;

    const problem =
      emailProblem(next.email) ??
      textProblem("display name", next.displayName, 120) ??
      localeProblem(next.locale) ??
      (USER_STATUSES.includes(next.status) ? undefined : "status is not valid");
    if (problem) return violation(problem);

    if (next.status === "DISABLED" && (await isLastActiveAdmin(this.repo, current))) {
      return violation("the last active administrator cannot be disabled");
    }
    const updated = await attempt(() => this.repo.updateUser(next, i.version));
    if (updated.ok && current.status !== "DISABLED" && next.status === "DISABLED") {
      // Re-enabling the account later must not bring old sessions back to life.
      await this.sessions?.revokeUserSessions(id, new Date());
    }
    return updated;
  }

  /** Sets a new password without asking for the old one: an administrator's reset. */
  async setPassword(id: string, password: string): Promise<Result<null, IdentityError>> {
    const user = await this.repo.getUser(id);
    if (!user) return err(new NotFoundError("user"));
    const problem = passwordProblem(password, user.username);
    if (problem) return violation(problem);

    const passwordHash = await this.hasher.hash(password);
    const saved = await attempt(() =>
      this.repo.setPassword(id, passwordHash, this.hasher.algorithm),
    );
    if (!saved.ok) return saved;
    await this.sessions?.revokeUserSessions(id, new Date());
    return ok(null);
  }
}
