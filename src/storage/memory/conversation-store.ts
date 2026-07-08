import type { ConversationMessage } from "../../domain/types";
import type { ConversationStore } from "../../ports";

/** In-memory conversation memory (tests / STORE=memory). */
export class MemoryConversationStore implements ConversationStore {
  private readonly m = new Map<string, ConversationMessage[]>();

  async load(key: string, limit?: number): Promise<ConversationMessage[]> {
    const all = this.m.get(key) ?? [];
    return limit ? all.slice(-limit) : [...all];
  }

  async append(
    key: string,
    messages: ConversationMessage[],
    opts?: { maxMessages?: number },
  ): Promise<void> {
    const all = this.m.get(key) ?? [];
    all.push(...messages);
    if (opts?.maxMessages && all.length > opts.maxMessages) {
      all.splice(0, all.length - opts.maxMessages);
    }
    this.m.set(key, all);
  }
}
