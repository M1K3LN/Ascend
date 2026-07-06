import { describe, expect, it } from "vitest";
import { decryptString, encryptString, isEncrypted, parseEncryptionKey } from "./crypto.js";

const key = parseEncryptionKey("a".repeat(64));

describe("token encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const token = "shpat_super_secret_token";
    const ciphertext = encryptString(token, key);
    expect(ciphertext).not.toContain(token);
    expect(isEncrypted(ciphertext)).toBe(true);
    expect(decryptString(ciphertext, key)).toBe(token);
  });

  it("produces distinct ciphertexts per call (random IV)", () => {
    expect(encryptString("x", key)).not.toBe(encryptString("x", key));
  });

  it("passes through legacy plaintext values", () => {
    expect(decryptString("shpat_plain", key)).toBe("shpat_plain");
  });

  it("rejects tampered ciphertext", () => {
    const ciphertext = encryptString("secret", key);
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith("A") ? "BB" : "AA");
    expect(() => decryptString(tampered, key)).toThrow();
  });

  it("rejects malformed keys", () => {
    expect(() => parseEncryptionKey("deadbeef")).toThrow(/32 bytes/);
  });
});
