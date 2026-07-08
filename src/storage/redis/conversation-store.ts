import type { ConversationMessage } from "../../domain/types";
import type { ConversationStore } from "../../ports";
import { redis } from "./client";

/** Conversation memory backed by a Redis list per key (atomic append). */
export class RedisConversationStore implements ConversationStore {
  private k(key: string): string {
    return `conv:${key}`;
  }

  async load(key: string, limit?: number): Promise<ConversationMessage[]> {
    const raw = (await redis().lrange(this.k(key), limit ? -limit : 0, -1)) as unknown[];
    return raw.map((e) => (typeof e === "string" ? (JSON.parse(e) as ConversationMessage) : (e as ConversationMessage)));
  }

  async append(
    key: string,
    messages: ConversationMessage[],
    opts?: { maxMessages?: number; ttlSec?: number },
  ): Promise<void> {
    if (messages.length === 0) return;
    const k = this.k(key);
    await redis().rpush(k, ...messages.map((m) => JSON.stringify(m)));
    if (opts?.maxMessages) await redis().ltrim(k, -opts.maxMessages, -1);
    if (opts?.ttlSec) await redis().expire(k, opts.ttlSec);
  }
}
