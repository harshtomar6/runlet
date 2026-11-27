import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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

/**
 * Constant-time comparison for shared secrets (admin/internal headers). Both
 * sides are hashed first so neither the content nor the length leaks via timing.
 */
export function secretEquals(provided: string | undefined, expected: string): boolean {
  if (provided === undefined) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
