import { describe, expect, it } from "vitest";
import { passwordProblem } from "../../modules/identity/domain/model.js";
import { ScryptPasswordHasher } from "../../modules/identity/infrastructure/scrypt-password-hasher.js";

// Cheap settings so the tests stay fast; production uses DEFAULT_SCRYPT_COST.
const cheap = new ScryptPasswordHasher({ N: 2 ** 10, r: 8, p: 1 });
const stronger = new ScryptPasswordHasher({ N: 2 ** 11, r: 8, p: 1 });

describe("ScryptPasswordHasher", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await cheap.hash("correct horse battery");
    expect(await cheap.verify("correct horse battery", stored)).toBe(true);
    expect(await cheap.verify("correct horse batterz", stored)).toBe(false);
    expect(await cheap.verify("", stored)).toBe(false);
  });

  it("uses a new random salt every time", async () => {
    const [a, b] = [await cheap.hash("same password 1"), await cheap.hash("same password 1")];
    expect(a).not.toBe(b);
    expect(await cheap.verify("same password 1", a)).toBe(true);
    expect(await cheap.verify("same password 1", b)).toBe(true);
  });

  it("stores the algorithm and cost inside the hash, never the password", async () => {
    const stored = await cheap.hash("a secret passphrase");
    expect(stored.startsWith("scrypt$1024$8$1$")).toBe(true);
    expect(stored).not.toContain("a secret passphrase");
    expect(cheap.algorithm).toBe("scrypt");
  });

  it("treats visually identical unicode forms as the same password", async () => {
    const composed = "caf\u00e9 au lait 1";
    const decomposed = "cafe\u0301 au lait 1";
    const stored = await cheap.hash(composed);
    expect(await cheap.verify(decomposed, stored)).toBe(true);
  });

  it("refuses a malformed stored hash instead of throwing", async () => {
    for (const bad of [
      "",
      "nonsense",
      "scrypt$1$8$1$a$b",
      "bcrypt$1024$8$1$YQ==$YQ==",
      "scrypt$1000$8$1$YQ==$YQ==",
    ]) {
      expect(await cheap.verify("anything at all", bad), bad).toBe(false);
    }
  });

  it("says when a hash was made with weaker settings", async () => {
    const stored = await cheap.hash("upgrade me please");
    expect(cheap.needsRehash(stored)).toBe(false);
    expect(stronger.needsRehash(stored)).toBe(true);
    expect(stronger.needsRehash(await stronger.hash("upgrade me please"))).toBe(false);
    expect(cheap.needsRehash("malformed")).toBe(true);
    // An old hash still verifies after the settings are raised.
    expect(await stronger.verify("upgrade me please", stored)).toBe(true);
  });
});

describe("passwordProblem", () => {
  it("accepts a password of a sensible length", () => {
    expect(passwordProblem("a long enough passphrase")).toBeUndefined();
    expect(passwordProblem("x".repeat(10))).toBeUndefined();
    expect(passwordProblem("x".repeat(128))).toBeUndefined();
  });

  it("refuses one that is too short or too long", () => {
    expect(passwordProblem("short")).toContain("at least");
    expect(passwordProblem("x".repeat(9))).toContain("at least");
    expect(passwordProblem("x".repeat(129))).toContain("at most");
  });

  it("refuses the username, ignoring case", () => {
    expect(passwordProblem("Warehouse.Manager", "warehouse.manager")).toContain("username");
    expect(passwordProblem("a different password", "warehouse.manager")).toBeUndefined();
  });

  it("has no composition rules", () => {
    expect(passwordProblem("alllowercaseletters")).toBeUndefined();
    expect(passwordProblem("1234567890")).toBeUndefined();
  });
});
