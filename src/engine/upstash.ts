import { serve } from "@upstash/workflow/hono";
import { defaultConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import { sendAlert } from "../observability/alert";
import { store } from "../storage/factory";
import type { ExecutionContext } from "./context";
import { runWorkflow } from "./interpreter";
import { LoggingEventSink } from "./logging-sink";
import { StoreEventSink } from "./sink";

export interface EnginePayload {
  runId: string;
  ownerId: string;
  workflowId: string;
  versionId: string;
  trigger: unknown;
}

/**
 * The single durable engine endpoint. Interprets any workflow via QStash-backed
 * durable steps. Mounted at POST /engine and invoked by the QStash dispatcher.
 */
export const engineRoute = serve<EnginePayload>(
  async (context) => {
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
      sink: new LoggingEventSink(new StoreEventSink(store.events)),
      rt: {
        kv: store.kv,
        credentials: store.credentials,
        connectors: defaultConnectors(),
        conversations: store.conversations,
        ownerId: context.requestPayload.ownerId,
      },
    });

    await store.events.updateRun(runId, {
      status: "succeeded",
      finishedAt: new Date(),
      workflowRunId: context.workflowRunId,
    });
  },
  {
    // Invoked when a run exhausts retries. Record run.failed, mark failed, alert.
    failureFunction: async ({ context, failStatus, failResponse }) => {
      const payload = context.requestPayload as EnginePayload | undefined;
      const runId = payload?.runId;
      let failedNodeId: string | undefined;
      if (runId) {
        // Recover the failing node from the most recent node.failed event (§11).
        const events = await store.events.listEvents(runId);
        for (const e of events) if (e.type === "node.failed" && e.nodeId) failedNodeId = e.nodeId;
        await store.events.append({
          id: newId(),
          runId,
          type: "run.failed",
          error: { failStatus, failResponse, failedNodeId },
          ts: new Date(),
        });
        await store.events.updateRun(runId, { status: "failed", finishedAt: new Date() });
      }
      await sendAlert("Workflow run failed", {
        runId: runId ?? "unknown",
        workflowId: payload?.workflowId ?? "unknown",
        failedNodeId: failedNodeId ?? "unknown",
        failStatus,
        failResponse,
      });
    },
  },
);
