import { decryptString, encryptString, parseEncryptionKey } from "@ascend/shared/crypto";
import { requireEnv } from "./env.server";

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (!cachedKey) cachedKey = parseEncryptionKey(requireEnv("ENCRYPTION_KEY"));
  return cachedKey;
}

export const encryptSecret = (plaintext: string) => encryptString(plaintext, key());
export const decryptSecret = (ciphertext: string) => decryptString(ciphertext, key());
