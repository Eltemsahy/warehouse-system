import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Result } from "../../../shared/kernel/index.js";
import type { AccessService } from "../application/access-service.js";
import type { AuthService } from "../application/auth-service.js";
import type { UserService } from "../application/user-service.js";
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  TooManyAttemptsError,
  type IdentityError,
} from "../domain/errors.js";
import {
  EMAIL_PATTERN,
  LOCALE_PATTERN,
  ROLE_CODE_PATTERN,
  USERNAME_MESSAGE,
  USERNAME_PATTERN,
  USER_STATUSES,
  type Principal,
  type Role,
  type UserAccount,
} from "../domain/model.js";

const id = z.string().uuid();
const version = z.number().int().min(1);
const username = z.string().regex(USERNAME_PATTERN, USERNAME_MESSAGE);
const email = z.string().max(254).regex(EMAIL_PATTERN, "must be an email address");
const locale = z.string().regex(LOCALE_PATTERN, "must look like en or ar-EG");
const displayName = z.string().min(1).max(120);
const hasChanges = (body: Record<string, unknown>) =>
  Object.keys(body).some((k) => k !== "version");

const params = z.object({ id });
const roleCode = z.string().regex(ROLE_CODE_PATTERN, "must be a role code such as PICKER");
const roleParams = z.object({ id, role: roleCode });
const warehouseParams = z.object({ id, warehouseId: z.string().uuid() });
// The password policy (length, not the username) is a rule, so it answers 422 from the service.
const createUser = z
  .object({
    username,
    email: email.nullable().optional(),
    displayName,
    password: z.string(),
    locale: locale.optional(),
  })
  .strict();
// The username is deliberately absent: it never changes.
const updateUser = z
  .object({
    version,
    email: email.nullable().optional(),
    displayName: displayName.optional(),
    locale: locale.optional(),
    status: z.enum(USER_STATUSES).optional(),
  })
  .strict()
  .refine(hasChanges, "nothing to update");
const setPassword = z.object({ password: z.string() }).strict();
// Bounded so nobody can make the server hash a megabyte; the real password policy is the service's.
const login = z
  .object({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024) })
  .strict();
const changeOwnPassword = z
  .object({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().max(1024) })
  .strict();
const listQuery = z
  .object({
    status: z.enum(USER_STATUSES).optional(),
    after: username.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

/** Never includes anything about the password. */
const present = (u: UserAccount) => ({
  id: u.id,
  username: u.username,
  email: u.email,
  displayName: u.displayName,
  status: u.status,
  locale: u.locale,
  createdAt: u.createdAt,
  updatedAt: u.updatedAt,
  version: u.version,
});

const presentRole = (r: Role) => ({
  code: r.code,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  allWarehouses: r.allWarehouses,
  permissions: r.permissions,
});

function statusOf(error: IdentityError): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof TooManyAttemptsError) return 429;
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422;
}

function fail(res: Response, error: IdentityError): Response {
  if (error instanceof TooManyAttemptsError)
    res.setHeader("Retry-After", String(error.retryAfterSeconds));
  if (error instanceof AuthenticationError) res.setHeader("WWW-Authenticate", "Bearer");
  return res.status(statusOf(error)).json({ error: error.message });
}

function send<T>(
  res: Response,
  result: Result<T, IdentityError>,
  status: number,
  present: (v: T) => unknown,
): Response {
  if (result.ok) return res.status(status).json(present(result.value));
  return fail(res, result.error);
}

function noContent(res: Response, result: Result<null, IdentityError>): Response {
  if (result.ok) return res.status(204).end();
  return fail(res, result.error);
}

export interface IdentityRouteDeps {
  users: UserService;
  access: AccessService;
  auth: AuthService;
}

/**
 * Mounted at /identity. A body or query that does not validate answers 400; a missing user 404;
 * a taken username or email, or a stale version, 409; a broken rule (such as a weak password) 422.
 * Login answers 401 for any bad credentials, in the same words, and 429 with Retry-After when a
 * username or address has failed too often.
 * PATCH must send the `version` it last read. Usernames can never be changed. Roles and
 * permissions are fixed (ADR 0005): the API lists them and assigns roles, nothing more.
 */
/** The session token from "Authorization: Bearer <token>", or undefined. */
function bearerToken(req: Request): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(req.header("Authorization") ?? "");
  return match?.[1];
}

export function identityRoutes(deps: IdentityRouteDeps) {
  const r = Router();

  /** The caller from the bearer token, or null after answering 401. */
  async function signedIn(req: Request, res: Response): Promise<Principal | null> {
    const token = bearerToken(req);
    const who = token === undefined ? null : await deps.auth.authenticate(token);
    if (!who) {
      fail(res, new AuthenticationError("authentication required"));
      return null;
    }
    return who;
  }

  // ---- login and sessions (ADR 0006). These routes read the token themselves; protecting the
  // other routes with it comes in a later step.

  r.post("/login", async (req, res) => {
    const body = login.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    const result = await deps.auth.login({ ...body.data, ip: req.ip ?? null });
    res.setHeader("Cache-Control", "no-store"); // the response holds a token
    return send(res, result, 200, ({ token, expiresAt, user }) => ({
      token,
      tokenType: "Bearer",
      expiresAt,
      user: present(user),
    }));
  });

  r.post("/logout", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return res;
    await deps.auth.logout(who.sessionId);
    return res.status(204).end();
  });

  /** Who am I, what may I do and where, and when does this session end. */
  r.get("/me", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return res;
    const user = await deps.users.get(who.userId);
    if (!user.ok) return fail(res, user.error);
    return res.json({
      user: present(user.value),
      access: who.access,
      session: { expiresAt: who.expiresAt },
    });
  });

  r.put("/me/password", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return res;
    const body = changeOwnPassword.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return noContent(res, await deps.auth.changePassword(who, body.data, req.ip ?? null));
  });

  /** A forced sign-out: ends every session of the user. */
  r.delete("/users/:id/sessions", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return noContent(res, await deps.auth.revokeSessions(p.data.id));
  });

  r.post("/users", async (req, res) => {
    const body = createUser.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.users.create(body.data), 201, present);
  });

  r.get("/users", async (req, res) => {
    const query = listQuery.safeParse(req.query);
    if (!query.success) return res.status(400).json(query.error.flatten());
    const page = await deps.users.list(query.data);
    return res.json({ items: page.items.map(present), nextAfter: page.nextAfter });
  });

  r.get("/users/:id", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return send(res, await deps.users.get(p.data.id), 200, present);
  });

  r.patch("/users/:id", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    const body = updateUser.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return send(res, await deps.users.update(p.data.id, body.data), 200, present);
  });

  r.put("/users/:id/password", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    const body = setPassword.safeParse(req.body);
    if (!body.success) return res.status(400).json(body.error.flatten());
    return noContent(res, await deps.users.setPassword(p.data.id, body.data.password));
  });

  // ---- roles, permissions and warehouse access (ADR 0005)

  r.get("/permissions", async (_req, res) =>
    res.json({ items: await deps.access.listPermissions() }),
  );

  r.get("/roles", async (_req, res) =>
    res.json({ items: (await deps.access.listRoles()).map(presentRole) }),
  );

  r.get("/users/:id/roles", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return send(res, await deps.access.rolesOf(p.data.id), 200, (roles) => ({
      items: roles.map(presentRole),
    }));
  });

  r.put("/users/:id/roles/:role", async (req, res) => {
    const p = roleParams.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return noContent(res, await deps.access.assignRole(p.data.id, p.data.role));
  });

  r.delete("/users/:id/roles/:role", async (req, res) => {
    const p = roleParams.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return noContent(res, await deps.access.removeRole(p.data.id, p.data.role));
  });

  r.get("/users/:id/warehouses", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return send(res, await deps.access.warehousesOf(p.data.id), 200, (items) => ({ items }));
  });

  r.put("/users/:id/warehouses/:warehouseId", async (req, res) => {
    const p = warehouseParams.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return noContent(res, await deps.access.grantWarehouse(p.data.id, p.data.warehouseId));
  });

  r.delete("/users/:id/warehouses/:warehouseId", async (req, res) => {
    const p = warehouseParams.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    return noContent(res, await deps.access.revokeWarehouse(p.data.id, p.data.warehouseId));
  });

  /** What the user may do and where, from all their roles and grants. Empty for a disabled user. */
  r.get("/users/:id/access", async (req, res) => {
    const p = params.safeParse(req.params);
    if (!p.success) return res.status(400).json(p.error.flatten());
    const user = await deps.users.get(p.data.id);
    if (!user.ok) return fail(res, user.error);
    return res.json(await deps.access.accessFor(p.data.id));
  });

  return r;
}
