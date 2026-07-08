import { Client } from "@upstash/workflow";
import { env } from "../config/env";
import { defaultConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import type { Run } from "../domain/types";
import { store } from "../storage/factory";
import { LocalExecutionContext } from "./local-context";
import { runWorkflow } from "./interpreter";
import { StoreEventSink } from "./sink";

export interface StartInput {
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
class LocalDispatcher implements Dispatcher {
  async start(input: StartInput): Promise<{ runId: string }> {
    const runId = newId();
    await store.events.createRun(newRunRow(runId, input));
    const def = await store.workflows.getVersion(input.workflowId, input.versionId);
    const exec = new LocalExecutionContext(runId);
    try {
      await runWorkflow(exec, {
        runId,
        def,
        trigger: input.trigger,
        sink: new StoreEventSink(store.events),
        rt: { kv: store.kv, credentials: store.credentials, connectors: defaultConnectors() },
      });
      await store.events.updateRun(runId, {
        status: "succeeded",
        finishedAt: new Date(),
        workflowRunId: exec.workflowRunId,
      });
    } catch (err) {
      await store.events.updateRun(runId, { status: "failed", finishedAt: new Date() });
      throw err;
    }
    return { runId };
  }
}

/** Enqueues a durable run to the engine endpoint via QStash. */
class QStashDispatcher implements Dispatcher {
  async start(input: StartInput): Promise<{ runId: string }> {
    if (!env.ENGINE_URL) throw new Error("ENGINE_URL is required for qstash dispatch");
    if (!env.QSTASH_TOKEN) throw new Error("QSTASH_TOKEN is required for qstash dispatch");
    const runId = newId();
    await store.events.createRun(newRunRow(runId, input));
    const client = new Client({ token: env.QSTASH_TOKEN });
    await client.trigger({
      url: env.ENGINE_URL,
      body: { runId, workflowId: input.workflowId, versionId: input.versionId, trigger: input.trigger },
    });
    return { runId };
  }
}

export const dispatcher: Dispatcher =
  env.DISPATCH_MODE === "qstash" ? new QStashDispatcher() : new LocalDispatcher();
