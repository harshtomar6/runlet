import { ApiError } from "../../errors";
import type { KVState } from "../../ports";

/**
 * Fixed-window rate limit backed by KVState.incr. The counter key includes the
 * time bucket, and its TTL is set on first increment so windows self-expire.
 * Throws 429 once the limit is exceeded.
 */
export async function enforceRateLimit(
  kv: KVState,
  prefix: string,
  limit: number,
  windowSec: number,
): Promise<void> {
  const bucket = Math.floor(Date.now() / (windowSec * 1000));
  const count = await kv.incr(`ratelimit:${prefix}:${bucket}`, windowSec);
  if (count > limit) {
    throw new ApiError(429, "rate_limited", `Rate limit exceeded (${limit}/${windowSec}s)`);
  }
}
