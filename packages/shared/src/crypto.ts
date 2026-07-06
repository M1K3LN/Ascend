import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * App-level AES-256-GCM used for Shopify access tokens at rest. Ciphertext is
 * self-describing ("enc:v1:<iv>:<tag>:<data>", base64url parts) so key/scheme
 * rotation can be introduced later without a data migration.
 */

const PREFIX = "enc:v1:";

export function parseEncryptionKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes hex (64 hex chars). Generate: openssl rand -hex 32");
  }
  return key;
}

export function encryptString(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(":")
  );
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function decryptString(ciphertext: string, key: Buffer): string {
  if (!isEncrypted(ciphertext)) {
    // Tolerate legacy/plaintext values (e.g. sessions written before the key
    // was configured) instead of bricking auth.
    return ciphertext;
  }
  const [iv, tag, data] = ciphertext.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
