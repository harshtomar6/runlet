import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../config/env";

/**
 * AES-256-GCM helpers for credential secrets. Layout of the returned buffer:
 *   [ 12-byte IV | 16-byte auth tag | ciphertext ]
 */

const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  if (!env.CREDENTIAL_ENC_KEY) {
    throw new Error("CREDENTIAL_ENC_KEY is required to use the credential store");
  }
  const k = Buffer.from(env.CREDENTIAL_ENC_KEY, "base64");
  if (k.length !== 32) {
    throw new Error("CREDENTIAL_ENC_KEY must decode to 32 bytes (base64-encoded)");
  }
  return k;
}

export function encryptJson(value: unknown): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decryptJson<T = unknown>(payload: Buffer): T {
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
