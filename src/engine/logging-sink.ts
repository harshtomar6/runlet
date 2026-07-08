import type { RunEvent } from "../domain/types";
import { log } from "../observability/logger";
import type { EventSink } from "./sink";

/** Decorates an EventSink: forwards to the inner sink and structured-logs each event. */
export class LoggingEventSink implements EventSink {
  constructor(private readonly inner: EventSink) {}

  async append(e: RunEvent): Promise<void> {
    await this.inner.append(e);
    const level = e.type === "node.failed" || e.type === "run.failed" ? "error" : "debug";
    log[level](e.type, { runId: e.runId, nodeId: e.nodeId ?? undefined });
  }
}
