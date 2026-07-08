/**
 * Abstraction over the durable-execution primitives. The Upstash adapter maps
 * these to ctx.run/ctx.sleep; the local adapter runs inline (dev + tests).
 * Keeping the interpreter written against this interface makes it testable
 * without QStash.
 */
export interface ExecutionContext {
  workflowRunId: string;
  run<T>(stepId: string, fn: () => Promise<T>): Promise<T>;
  sleep(stepId: string, seconds: number): Promise<void>;
}
