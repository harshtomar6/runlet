import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "./context";

/**
 * In-memory execution context. Runs steps inline and (optionally) skips real
 * sleeping so flows complete instantly in dev/tests.
 */
export type EventResolver = (eventId: string) => { timedOut: boolean; data: unknown };

export class LocalExecutionContext implements ExecutionContext {
  readonly workflowRunId: string;
  readonly steps: string[] = []; // step ids run() was called with (for assertions)
  readonly sleeps: Array<{ stepId: string; seconds: number }> = [];
  readonly waits: Array<{ stepId: string; eventId: string }> = [];

  constructor(
    workflowRunId?: string,
    private readonly realSleep = false,
    private readonly eventResolver?: EventResolver,
  ) {
    this.workflowRunId = workflowRunId ?? `local_${randomUUID()}`;
  }

  async run<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
    this.steps.push(stepId);
    return fn();
  }

  async sleep(stepId: string, seconds: number): Promise<void> {
    this.sleeps.push({ stepId, seconds });
    if (this.realSleep && seconds > 0) {
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
  }

  // Local mode can't truly suspend; auto-approves unless a resolver is provided.
  async waitForEvent(
    stepId: string,
    eventId: string,
    _timeoutSec: number,
  ): Promise<{ timedOut: boolean; data: unknown }> {
    this.waits.push({ stepId, eventId });
    return this.eventResolver
      ? this.eventResolver(eventId)
      : { timedOut: false, data: { approved: true, auto: true } };
  }
}
