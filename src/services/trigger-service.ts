import { ApiError } from "../errors";
import type { Dispatcher } from "../engine/dispatch";
import type { Store } from "../ports";

/**
 * Starts runs from trigger sources (webhooks, events, schedule ticks). Only
 * ACTIVE workflows are triggerable, and always at their pinned active version
 * (§9) — never a draft or unactivated latest. NOT owner-scoped; callers
 * authenticate the source (signature / internal secret / owner event auth).
 */
export class TriggerService {
  constructor(
    private readonly store: Store,
    private readonly dispatcher: Dispatcher,
  ) {}

  async runWorkflowNow(workflowId: string, trigger: unknown): Promise<{ runId: string }> {
    const wf = await this.store.workflows.getWorkflow(workflowId);
    if (wf.status !== "active" || !wf.activeVersionId) {
      throw new ApiError(
        409,
        "workflow_not_active",
        `Workflow ${workflowId} is not active (status=${wf.status})`,
      );
    }
    return this.dispatcher.start({
      ownerId: wf.ownerId,
      workflowId,
      versionId: wf.activeVersionId,
      trigger,
    });
  }
}
