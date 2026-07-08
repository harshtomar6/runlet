import { serve } from "@upstash/workflow/hono";
import { defaultConnectors } from "../connectors/default";
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
});
