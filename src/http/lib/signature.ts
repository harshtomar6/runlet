import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 hex signature of a raw body with a shared secret. */
export function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifySignature(body: string, secret: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = sign(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
