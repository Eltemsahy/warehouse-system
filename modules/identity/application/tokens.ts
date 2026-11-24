import { createHash, randomBytes } from "node:crypto";

const PREFIX = "wms_";

/** "wms_" plus 32 random bytes as base64url (43 characters). The prefix makes leaks easy to grep. */
export const TOKEN_PATTERN = /^wms_[A-Za-z0-9_-]{43}$/;

export const generateToken = (): string => `${PREFIX}${randomBytes(32).toString("base64url")}`;

/**
 * What is stored instead of the token. The token is 256 random bits, so a plain SHA-256 is
 * enough: there is nothing to brute-force, unlike a password.
 */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
