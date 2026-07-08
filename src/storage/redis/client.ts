import { Redis } from "@upstash/redis";
import { env } from "../../config/env";

let _redis: Redis | null = null;

/** Lazily-initialised Upstash Redis client. */
export function redis(): Redis {
  if (!_redis) {
    if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required for the KVState store",
      );
    }
    _redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}
