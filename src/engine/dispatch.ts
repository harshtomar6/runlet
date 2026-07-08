import { Client } from "@upstash/workflow";
import { env } from "../config/env";
import { defaultConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import type { Run } from "../domain/types";
import type { Store } from "../ports";
import { store as defaultStore } from "../storage/factory";
import { LocalExecutionContext } from "./local-context";
import { LoggingEventSink } from "./logging-sink";
import { runWorkflow } from "./interpreter";
import { StoreEventSink } from "./sink";

export interface StartInput {
  ownerId: string;
  workflowId: string;
  versionId: string;
  trigger: unknown;
}

export interface Dispatcher {
  start(input: StartInput): Promise<{ runId: string }>;
}

function newRunRow(runId: string, input: StartInput): Run {
  return {
    id: runId,
    ownerId: input.ownerId,
    workflowId: input.workflowId,
    versionId: input.versionId,
    status: "running",
    trigger: input.trigger,
    workflowRunId: null,
    startedAt: new Date(),
    finishedAt: null,
  };
}

/** Runs the interpreter inline. For dev / no-infra; sleeps are recorded, not awaited. */
export class LocalDispatcher implements Dispatcher {
  constructor(private readonly store: Store) {}

  async start(input: StartInput): Promise<{ runId: string }> {
    const runId = newId();
    await this.store.events.createRun(newRunRow(runId, input));
    const def = await this.store.workflows.getVersion(input.workflowId, input.versionId);
    const exec = new LocalExecutionContext(runId);
    try {
      await runWorkflow(exec, {
        runId,
        def,
        trigger: input.trigger,
        sink: new LoggingEventSink(new StoreEventSink(this.store.events)),
        rt: {
          kv: this.store.kv,
          credentials: this.store.credentials,
          connectors: defaultConnectors(),
          conversations: this.store.conversations,
          ownerId: input.ownerId,
        },
      });
      await this.store.events.updateRun(runId, {
        status: "succeeded",
        finishedAt: new Date(),
        workflowRunId: exec.workflowRunId,
      });
    } catch (err) {
      await this.store.events.append({
        id: newId(),
        runId,
        type: "run.failed",
        error: { message: err instanceof Error ? err.message : String(err) },
        ts: new Date(),
      });
      await this.store.events.updateRun(runId, { status: "failed", finishedAt: new Date() });
      throw err;
    }
    return { runId };
  }
}

/** Enqueues a durable run to the engine endpoint via QStash. */
export class QStashDispatcher implements Dispatcher {
  constructor(private readonly store: Store) {}

  async start(input: StartInput): Promise<{ runId: string }> {
    if (!env.ENGINE_URL) throw new Error("ENGINE_URL is required for qstash dispatch");
    if (!env.QSTASH_TOKEN) throw new Error("QSTASH_TOKEN is required for qstash dispatch");
    const runId = newId();
    await this.store.events.createRun(newRunRow(runId, input));
    const client = new Client({ token: env.QSTASH_TOKEN });
    await client.trigger({
      url: env.ENGINE_URL,
      body: {
        runId,
        ownerId: input.ownerId,
        workflowId: input.workflowId,
        versionId: input.versionId,
        trigger: input.trigger,
      },
    });
    return { runId };
  }
}

export function makeDispatcher(store: Store): Dispatcher {
  return env.DISPATCH_MODE === "qstash" ? new QStashDispatcher(store) : new LocalDispatcher(store);
}

export const dispatcher: Dispatcher = makeDispatcher(defaultStore);
