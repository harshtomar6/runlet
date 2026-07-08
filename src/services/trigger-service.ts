import { ApiError } from "../errors";
import type { Dispatcher } from "../engine/dispatch";
import { NotFoundError } from "../ports/errors";
import type { Store } from "../ports";

/**
 * Starts runs from trigger sources (webhooks, events, schedule ticks). Resolves
 * the runnable version (active, else latest) and is NOT owner-scoped — callers
 * authenticate the source (signature / internal secret / owner event auth).
 */
export class TriggerService {
  constructor(
    private readonly store: Store,
    private readonly dispatcher: Dispatcher,
  ) {}

  async runWorkflowNow(workflowId: string, trigger: unknown): Promise<{ runId: string }> {
    const wf = await this.store.workflows.getWorkflow(workflowId);
    if (wf.status === "disabled") {
      throw new ApiError(409, "workflow_disabled", `Workflow ${workflowId} is disabled`);
    }
    const versionId = wf.activeVersionId ?? (await this.store.workflows.listVersions(workflowId))[0]?.id;
    if (!versionId) throw new NotFoundError("WorkflowVersion", `${workflowId}:latest`);
    return this.dispatcher.start({ workflowId, versionId, trigger });
  }
}
