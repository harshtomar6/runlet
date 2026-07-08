import type { KVState } from "../../ports";

/** In-memory KVState for local dispatch, demos, and tests (ignores TTL). */
export class MemoryKVState implements KVState {
  private readonly m = new Map<string, string>();

  async setNX(key: string, val: string): Promise<boolean> {
    if (this.m.has(key)) return false;
    this.m.set(key, val);
    return true;
  }

  async set(key: string, val: string): Promise<void> {
    this.m.set(key, val);
  }

  async get(key: string): Promise<string | null> {
    return this.m.get(key) ?? null;
  }

  async incr(key: string): Promise<number> {
    const n = Number(this.m.get(key) ?? "0") + 1;
    this.m.set(key, String(n));
    return n;
  }

  async del(key: string): Promise<void> {
    this.m.delete(key);
  }
}
