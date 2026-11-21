import { Router, type Response } from "express";
import { z } from "zod";
import type { Result } from "../../../shared/kernel/index.js";
import type { UserService } from "../application/user-service.js";
import { ConflictError, NotFoundError, type IdentityError } from "../domain/errors.js";
import {
  EMAIL_PATTERN,
  LOCALE_PATTERN,
  USERNAME_MESSAGE,
  USERNAME_PATTERN,
  USER_STATUSES,
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

function statusOf(error: IdentityError): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ConflictError) return 409;
  return 422;
}

function send<T>(
  res: Response,
  result: Result<T, IdentityError>,
  status: number,
  present: (v: T) => unknown,
): Response {
  if (result.ok) return res.status(status).json(present(result.value));
  return res.status(statusOf(result.error)).json({ error: result.error.message });
}

export interface IdentityRouteDeps {
  users: UserService;
}

/**
 * Mounted at /identity. A body or query that does not validate answers 400; a missing user 404;
 * a taken username or email, or a stale version, 409; a broken rule (such as a weak password) 422.
 * PATCH must send the `version` it last read. Usernames can never be changed.
 */
export function identityRoutes(deps: IdentityRouteDeps) {
  const r = Router();

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
    const result = await deps.users.setPassword(p.data.id, body.data.password);
    if (!result.ok) return res.status(statusOf(result.error)).json({ error: result.error.message });
    return res.status(204).end();
  });

  return r;
}
