import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { logger } from "../observability/index.js";
import type { IdempotencyStore } from "./idempotency-store.js";

export const IDEMPOTENCY_HEADER = "Idempotency-Key";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const VALID_KEY = /^[\x21-\x7E]{1,255}$/; // printable ASCII, no spaces, 1-255 chars

export interface IdempotencyOptions {
  /** How long a key is remembered. Default 24 hours. */
  ttlMs?: number;
  /** Reject mutating requests that have no Idempotency-Key. Default false. */
  required?: boolean;
  /** Who owns the key. Keys are scoped per caller. Default "anonymous" (until auth exists). */
  principal?: (req: Request) => string;
}

/** Same JSON with object keys sorted, so key order in a retried body doesn't matter. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

function requestHash(req: Request): string {
  const body = JSON.stringify(canonical(req.body)) ?? "null";
  return createHash("sha256").update(`${req.method}\n${req.originalUrl}\n${body}`).digest("hex");
}

/**
 * Makes the response of a claimed key durable BEFORE it reaches the client, so a retry after
 * a lost response always finds it. Works even if the client has already disconnected.
 * 5xx responses are not kept: the key is released so the client may retry.
 */
function recordResponse(store: IdempotencyStore, key: string, userId: string, res: Response) {
  let body: unknown = null;
  let settled = false;

  const originalJson = res.json.bind(res);
  res.json = (payload?: unknown) => {
    body = payload ?? null;
    return originalJson(payload);
  };

  const originalEnd = res.end.bind(res) as unknown as (...args: unknown[]) => Response;
  res.end = ((...args: unknown[]) => {
    if (settled) return originalEnd(...args);
    settled = true;
    const status = res.statusCode;
    void (async () => {
      try {
        if (status >= 500) await store.release(key, userId);
        else await store.complete(key, userId, status, body);
      } catch (e) {
        logger.error("could not record idempotent response", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      originalEnd(...args);
    })();
    return res;
  }) as Response["end"];
}

/**
 * Idempotency-Key support for mutating requests (TRD s5.5, Implementation Plan P0-7).
 * Mount after express.json() and before the routers. JSON APIs only: a replayed response is
 * the stored status plus JSON body.
 *
 * - no key: the request runs normally (unless `required`)
 * - first time: the request runs and its response is stored
 * - same key + same request: the stored response is sent again, nothing runs
 * - same key, request still running: 409
 * - same key, different request: 422
 */
export function idempotency(
  store: IdempotencyStore,
  options: IdempotencyOptions = {},
): RequestHandler {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const principal = options.principal ?? (() => "anonymous");

  return async (req, res, next) => {
    if (!MUTATING.has(req.method)) return next();
    try {
      const key = req.header(IDEMPOTENCY_HEADER);
      if (key === undefined) {
        if (!options.required) return next();
        res.status(400).json({ error: `${IDEMPOTENCY_HEADER} header is required` });
        return;
      }
      if (!VALID_KEY.test(key)) {
        res.status(400).json({ error: `${IDEMPOTENCY_HEADER} must be 1-255 printable characters` });
        return;
      }

      const userId = principal(req);
      const begin = await store.begin(key, userId, requestHash(req), ttlMs);
      switch (begin.kind) {
        case "replay":
          res.setHeader("Idempotent-Replayed", "true");
          if (begin.body === null) res.status(begin.status).end();
          else res.status(begin.status).json(begin.body);
          return;
        case "in_progress":
          res.setHeader("Retry-After", "1");
          res.status(409).json({ error: "a request with this Idempotency-Key is still in progress" });
          return;
        case "mismatch":
          res.status(422).json({ error: "Idempotency-Key was already used with a different request" });
          return;
        case "claimed":
          recordResponse(store, key, userId, res);
          next();
      }
    } catch (e) {
      next(e);
    }
  };
}