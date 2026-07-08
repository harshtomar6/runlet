import { randomUUID } from "node:crypto";
import type { ExecutionContext } from "./context";

/**
 * In-memory execution context. Runs steps inline and (optionally) skips real
 * sleeping so flows complete instantly in dev/tests.
 */
export class LocalExecutionContext implements ExecutionContext {
  readonly workflowRunId: string;
  readonly sleeps: Array<{ stepId: string; seconds: number }> = [];

  constructor(workflowRunId?: string, private readonly realSleep = false) {
    this.workflowRunId = workflowRunId ?? `local_${randomUUID()}`;
  }

  async run<T>(_stepId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async sleep(stepId: string, seconds: number): Promise<void> {
    this.sleeps.push({ stepId, seconds });
    if (this.realSleep && seconds > 0) {
      await new Promise((r) => setTimeout(r, seconds * 1000));
    }
  }
}
