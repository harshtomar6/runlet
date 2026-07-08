import type { KVState } from "../../ports";
import { redis } from "./client";

export class RedisKVState implements KVState {
  async setNX(key: string, val: string, ttlSec: number): Promise<boolean> {
    const res = await redis().set(key, val, { nx: true, ex: ttlSec });
    return res === "OK";
  }

  async set(key: string, val: string, ttlSec?: number): Promise<void> {
    await redis().set(key, val, ttlSec ? { ex: ttlSec } : undefined);
  }

  async get(key: string): Promise<string | null> {
    return await redis().get<string>(key);
  }

  async incr(key: string, ttlSec?: number): Promise<number> {
    const n = await redis().incr(key);
    if (ttlSec && n === 1) await redis().expire(key, ttlSec); // window the counter
    return n;
  }

  async del(key: string): Promise<void> {
    await redis().del(key);
  }
}
