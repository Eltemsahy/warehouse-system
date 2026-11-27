import type { NextFunction, Request, RequestHandler, Response } from "express";
import { can, type Principal } from "../../../modules/identity/index.js";
import { logger } from "../../../shared/observability/index.js";

/**
 * What a route needs (ADR 0007).
 *  - "public": nobody has to sign in (login).
 *  - "signed-in": any valid session will do (the caller's own profile and password).
 *  - a permission, plus, for warehouse-scoped routes, the name of the path parameter that holds
 *    the warehouse id: the caller also needs access to that warehouse.
 */
export type Access = "public" | "signed-in" | { permission: string; warehouse?: string };

export interface Rule {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The full path as the client sends it, with `:name` for parameters. */
  path: string;
  access: Access;
}

interface Compiled {
  rule: Rule;
  pattern: RegExp;
  names: string[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(rule: Rule): Compiled {
  const names: string[] = [];
  const parts = rule.path
    .split("/")
    .slice(1)
    .map((segment) => {
      if (segment.startsWith(":")) {
        names.push(segment.slice(1));
        return "([^/]+)";
      }
      return escapeRegex(segment);
    });
  // Case-insensitive because Express routes without regard to case: a rule must match
  // whatever Express will match, or a request could slip past it.
  return { rule, pattern: new RegExp(`^/${parts.join("/")}$`, "i"), names };
}

export interface Match {
  rule: Rule;
  params: Record<string, string>;
}

/** The rule for a request, or undefined when none applies. A trailing slash is ignored, HEAD counts as GET. */
export function findRule(rules: readonly Rule[], method: string, path: string): Match | undefined {
  return matcher(rules)(method, path);
}

/** Compiles the rules once; the middleware uses this, `findRule` is the convenient form for tests. */
export function matcher(rules: readonly Rule[]) {
  const compiled = rules.map(compile);
  return (method: string, path: string): Match | undefined => {
    const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
    const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
    for (const c of compiled) {
      if (c.rule.method !== verb) continue;
      const m = c.pattern.exec(clean);
      if (!m) continue;
      try {
        const params: Record<string, string> = {};
        c.names.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1] ?? "");
        });
        return { rule: c.rule, params };
      } catch {
        return undefined; // malformed percent-encoding: treat as no rule, which is refused
      }
    }
    return undefined;
  };
}

const principals = new WeakMap<object, Principal>();
const matches = new WeakMap<object, Match>();

/** The rule that covered the request, once `protect` has let it through. Used by the audit trail. */
export const matchOf = (req: Request): Match | undefined => matches.get(req);

/** Who is calling, once `protect` has let the request through. Undefined on public routes. */
export const principalOf = (req: Request): Principal | undefined => principals.get(req);

function bearerToken(req: Request): string | undefined {
  return /^Bearer ([^\s]+)$/i.exec(req.header("Authorization") ?? "")?.[1];
}

export interface ProtectOptions {
  rules: readonly Rule[];
  authenticate: (token: string) => Promise<Principal | null>;
}

/**
 * Every request passes here before any module sees it, and nothing gets through by default:
 *  - a public route goes straight on;
 *  - anything else needs a live session, else 401;
 *  - a path no rule covers answers 404 and is never handed to a module, so a route added
 *    without a rule stays unreachable instead of open (a test checks every real route has one);
 *  - a rule with a permission needs it, and warehouse access where the route is scoped, else 403.
 */
export function protect({ rules, authenticate }: ProtectOptions): RequestHandler {
  const find = matcher(rules);
  return async (req: Request, res: Response, next: NextFunction) => {
    const match = find(req.method, req.path);
    if (match?.rule.access === "public") return next();

    const token = bearerToken(req);
    const who = token === undefined ? null : await authenticate(token);
    if (!who) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return res.status(401).json({ error: "authentication required" });
    }
    principals.set(req, who);
    if (match) matches.set(req, match);

    if (!match) return res.status(404).json({ error: "not found" });

    const access = match.rule.access;
    if (access !== "signed-in") {
      const warehouseId =
        access.warehouse === undefined ? undefined : match.params[access.warehouse];
      if (!can(who.access, access.permission, warehouseId)) {
        logger.warn("access denied", {
          userId: who.userId,
          method: req.method,
          path: req.path,
          permission: access.permission,
        });
        return res.status(403).json({ error: "you do not have permission to do this" });
      }
    }
    return next();
  };
}
