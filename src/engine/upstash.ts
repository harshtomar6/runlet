import { serve } from "@upstash/workflow/hono";
import { defaultConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import { store } from "../storage/factory";
import type { ExecutionContext } from "./context";
import { runWorkflow } from "./interpreter";
import { StoreEventSink } from "./sink";

export interface EnginePayload {
  runId: string;
  workflowId: string;
  versionId: string;
  trigger: unknown;
}

/**
 * The single durable engine endpoint. Interprets any workflow via QStash-backed
 * durable steps. Mounted at POST /engine and invoked by the QStash dispatcher.
 */
export const engineRoute = serve<EnginePayload>(async (context) => {
  const { runId, workflowId, versionId, trigger } = context.requestPayload;

  const def = await context.run("load-def", () =>
    store.workflows.getVersion(workflowId, versionId),
  );

  const exec: ExecutionContext = {
    workflowRunId: context.workflowRunId,
    run: (id, fn) => context.run(id, fn),
    sleep: (id, seconds) => context.sleep(id, seconds),
  };

  await runWorkflow(exec, {
    runId,
    def,
    trigger,
    sink: new StoreEventSink(store.events),
    rt: { kv: store.kv, credentials: store.credentials, connectors: defaultConnectors() },
  });

  await store.events.updateRun(runId, {
    status: "succeeded",
    finishedAt: new Date(),
    workflowRunId: context.workflowRunId,
  });
}, {
  // Invoked when a durable run exhausts retries: record the failure so the run
  // doesn't stay stuck in "running" (DESIGN §6.1/§11).
  failureFunction: async ({ context, failStatus, failResponse }) => {
    const payload = context.requestPayload as EnginePayload | undefined;
    const runId = payload?.runId;
    if (!runId) return;
    await store.events.append({
      id: newId(),
      runId,
      type: "run.failed",
      error: { failStatus, failResponse },
      ts: new Date(),
    });
    await store.events.updateRun(runId, { status: "failed", finishedAt: new Date() });
  },
});
