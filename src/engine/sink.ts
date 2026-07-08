import type { RunEvent } from "../domain/types";
import type { EventLog } from "../ports";

/** Where run events go. Store-backed in prod; in-memory for tests/demos. */
export interface EventSink {
  append(e: RunEvent): Promise<void>;
}

export class StoreEventSink implements EventSink {
  constructor(private readonly events: EventLog) {}
  async append(e: RunEvent): Promise<void> {
    await this.events.append(e);
  }
}

export class MemoryEventSink implements EventSink {
  readonly events: RunEvent[] = [];
  async append(e: RunEvent): Promise<void> {
    this.events.push(e);
  }
}
