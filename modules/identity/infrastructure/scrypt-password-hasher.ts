import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PasswordHasher } from "../application/ports.js";

export interface ScryptCost {
  /** CPU and memory cost, a power of two. */
  N: number;
  r: number;
  p: number;
}

/**
 * OWASP's scrypt guidance: N = 2^16, r = 8, p = 2 uses about 64 MiB per hash. Raise it as
 * hardware improves: older hashes keep working and report needsRehash.
 */
export const DEFAULT_SCRYPT_COST: ScryptCost = { N: 2 ** 16, r: 8, p: 2 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      // Node refuses to use more than maxmem; allow twice what scrypt needs.
      { N: cost.N, r: cost.r, p: cost.p, maxmem: 256 * cost.N * cost.r },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

interface Parsed {
  cost: ScryptCost;
  salt: Buffer;
  hash: Buffer;
}

/** Reads "scrypt$N$r$p$salt$hash"; undefined when it is not a hash this class made. */
function parse(stored: string): Parsed | undefined {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const sane = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
  if (!sane(N, 2 ** 20) || N < 2 || (N & (N - 1)) !== 0 || !sane(r, 64) || !sane(p, 64)) {
    return undefined;
  }
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const hash = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || hash.length !== KEY_LENGTH) return undefined;
  return { cost: { N, r, p }, salt, hash };
}

export class ScryptPasswordHasher implements PasswordHasher {
  readonly algorithm = "scrypt";

  constructor(private cost: ScryptCost = DEFAULT_SCRYPT_COST) {}

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(plain, salt, this.cost);
    const { N, r, p } = this.cost;
    return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) return false;
    const key = await derive(plain, parsed.salt, parsed.cost);
    return timingSafeEqual(key, parsed.hash);
  }

  needsRehash(stored: string): boolean {
    const parsed = parse(stored);
    if (!parsed) return true;
    const { N, r, p } = parsed.cost;
    return N < this.cost.N || r < this.cost.r || p < this.cost.p;
  }
}
