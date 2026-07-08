import { and, eq } from "drizzle-orm";
import type { EventSubscription } from "../../domain/types";
import type { SubscriptionRepo } from "../../ports";
import { db } from "./client";
import { eventSubscriptions } from "./schema";

export class PostgresSubscriptionRepo implements SubscriptionRepo {
  async create(s: EventSubscription): Promise<void> {
    await db().insert(eventSubscriptions).values(s);
  }

  async delete(id: string, ownerId: string): Promise<void> {
    await db()
      .delete(eventSubscriptions)
      .where(and(eq(eventSubscriptions.id, id), eq(eventSubscriptions.ownerId, ownerId)));
  }

  async listByOwner(ownerId: string): Promise<EventSubscription[]> {
    return db().select().from(eventSubscriptions).where(eq(eventSubscriptions.ownerId, ownerId));
  }

  async listByOwnerAndEventType(ownerId: string, eventType: string): Promise<EventSubscription[]> {
    return db()
      .select()
      .from(eventSubscriptions)
      .where(and(eq(eventSubscriptions.ownerId, ownerId), eq(eventSubscriptions.eventType, eventType)));
  }

  async listByWorkflow(workflowId: string): Promise<EventSubscription[]> {
    return db().select().from(eventSubscriptions).where(eq(eventSubscriptions.workflowId, workflowId));
  }
}
