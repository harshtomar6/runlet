import { and, desc, eq, ilike } from "drizzle-orm";
import type {
  TriggerConfig,
  Workflow,
  WorkflowStatus,
  WorkflowVersion,
} from "../../domain/types";
import type { WorkflowFilter, WorkflowRepo } from "../../ports";
import { NotFoundError } from "../../ports/errors";
import { db } from "./client";
import { workflowVersions, workflows } from "./schema";

type WorkflowRow = typeof workflows.$inferSelect;
type VersionRow = typeof workflowVersions.$inferSelect;

export class PostgresWorkflowRepo implements WorkflowRepo {
  async getWorkflow(id: string): Promise<Workflow> {
    const [row] = await db().select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!row) throw new NotFoundError("Workflow", id);
    return toWorkflow(row);
  }

  async list(ownerId: string, filter?: WorkflowFilter): Promise<Workflow[]> {
    const conds = [eq(workflows.ownerId, ownerId)];
    if (filter?.status) conds.push(eq(workflows.status, filter.status));
    if (filter?.q) conds.push(ilike(workflows.name, `%${filter.q}%`));

    const rows = await db()
      .select()
      .from(workflows)
      .where(and(...conds))
      .orderBy(desc(workflows.createdAt))
      .limit(filter?.limit ?? 50);

    return rows.map(toWorkflow);
  }

  async setStatus(id: string, status: WorkflowStatus): Promise<void> {
    await db()
      .update(workflows)
      .set({ status, updatedAt: new Date() })
      .where(eq(workflows.id, id));
  }

  async putWorkflow(w: Workflow): Promise<void> {
    await db()
      .insert(workflows)
      .values({
        id: w.id,
        ownerId: w.ownerId,
        name: w.name,
        status: w.status,
        activeVersionId: w.activeVersionId,
        trigger: w.trigger,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      })
      .onConflictDoUpdate({
        target: workflows.id,
        set: {
          name: w.name,
          status: w.status,
          activeVersionId: w.activeVersionId,
          trigger: w.trigger,
          updatedAt: w.updatedAt,
        },
      });
  }

  async getVersion(workflowId: string, versionId: string): Promise<WorkflowVersion> {
    const [row] = await db()
      .select()
      .from(workflowVersions)
      .where(and(eq(workflowVersions.id, versionId), eq(workflowVersions.workflowId, workflowId)))
      .limit(1);
    if (!row) throw new NotFoundError("WorkflowVersion", versionId);
    return toVersion(row);
  }

  async createVersion(v: WorkflowVersion): Promise<void> {
    await db().insert(workflowVersions).values({
      id: v.id,
      workflowId: v.workflowId,
      version: v.version,
      nodes: v.nodes,
      edges: v.edges,
      createdAt: v.createdAt,
    });
  }

  async activate(workflowId: string, versionId: string): Promise<void> {
    await db()
      .update(workflows)
      .set({ activeVersionId: versionId, status: "active", updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));
  }
}

function toWorkflow(r: WorkflowRow): Workflow {
  return {
    id: r.id,
    ownerId: r.ownerId,
    name: r.name,
    status: r.status as WorkflowStatus,
    activeVersionId: r.activeVersionId,
    trigger: r.trigger as TriggerConfig,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toVersion(r: VersionRow): WorkflowVersion {
  return {
    id: r.id,
    workflowId: r.workflowId,
    version: r.version,
    nodes: r.nodes,
    edges: r.edges,
    createdAt: r.createdAt,
  };
}
