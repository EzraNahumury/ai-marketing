// AES-256-GCM encryption for marketplace tokens.
// Output format: base64( iv (12 bytes) | authTag (16 bytes) | ciphertext )

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEncryptionKeyRaw } from "./env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;

function decodeKey(raw: string): Buffer {
  // Accept hex (64 chars) or base64.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === KEY_LEN * 2) {
    return Buffer.from(raw, "hex");
  }
  try {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === KEY_LEN) return buf;
  } catch {
    /* fall through */
  }
  throw new Error(
    "MARKETPLACE_TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as hex (64 chars) or base64",
  );
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = decodeKey(getEncryptionKeyRaw());
  return cachedKey;
}

export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encryptToken expects a string");
  }
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptToken(payload: string): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("decryptToken expects a non-empty string");
  }
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("Ciphertext is too short to be valid");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
