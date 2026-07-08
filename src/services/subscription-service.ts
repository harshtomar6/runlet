import { newId } from "../domain/ids";
import type { EventSubscription } from "../domain/types";
import { ApiError } from "../errors";
import type { Store } from "../ports";
import type { TriggerService } from "./trigger-service";

/** Manages event→workflow subscriptions and fans out incoming app events. */
export class SubscriptionService {
  constructor(
    private readonly store: Store,
    private readonly triggers: TriggerService,
  ) {}

  async create(
    ownerId: string,
    input: { eventType: string; workflowId: string },
  ): Promise<EventSubscription> {
    // Verify the target workflow belongs to the owner (throws 404 otherwise).
    const wf = await this.store.workflows.getWorkflow(input.workflowId);
    if (wf.ownerId !== ownerId) throw new ApiError(404, "not_found", "Workflow not found");

    const sub: EventSubscription = {
      id: newId(),
      ownerId,
      eventType: input.eventType,
      workflowId: input.workflowId,
    };
    await this.store.subscriptions.create(sub);
    return sub;
  }

  async list(ownerId: string): Promise<EventSubscription[]> {
    return this.store.subscriptions.listByOwner(ownerId);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.store.subscriptions.delete(id, ownerId);
  }

  /**
   * Fan out an incoming event to every subscribed workflow for this owner.
   * One bad subscription (disabled/never-activated/missing) must not block the
   * rest, so each dispatch is isolated and failures are collected (§9 "start each").
   */
  async dispatchEvent(
    ownerId: string,
    eventType: string,
    payload: unknown,
  ): Promise<{
    triggered: Array<{ workflowId: string; runId: string }>;
    failed: Array<{ workflowId: string; error: string }>;
  }> {
    const subs = await this.store.subscriptions.listByOwnerAndEventType(ownerId, eventType);
    const triggered: Array<{ workflowId: string; runId: string }> = [];
    const failed: Array<{ workflowId: string; error: string }> = [];
    for (const sub of subs) {
      try {
        const { runId } = await this.triggers.runWorkflowNow(sub.workflowId, payload);
        triggered.push({ workflowId: sub.workflowId, runId });
      } catch (err) {
        failed.push({
          workflowId: sub.workflowId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { triggered, failed };
  }
}
