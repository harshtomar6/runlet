import { and, count, desc, eq, gte, inArray, lte, type SQL } from "drizzle-orm";
import type { Run, RunEvent, RunStatus } from "../../domain/types";
import type { EventLog, RunQuery, RunSummary } from "../../ports";
import { NotFoundError } from "../../ports/errors";
import { db } from "./client";
import { runEvents, runs } from "./schema";

type RunRow = typeof runs.$inferSelect;
type EventRow = typeof runEvents.$inferSelect;

export class PostgresEventLog implements EventLog {
  async createRun(r: Run): Promise<void> {
    await db().insert(runs).values({
      id: r.id,
      ownerId: r.ownerId,
      workflowId: r.workflowId,
      versionId: r.versionId,
      status: r.status,
      trigger: r.trigger,
      workflowRunId: r.workflowRunId,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    });
  }

  async updateRun(id: string, patch: Partial<Run>): Promise<void> {
    const set: Partial<RunRow> = {};
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.workflowRunId !== undefined) set.workflowRunId = patch.workflowRunId;
    if (patch.finishedAt !== undefined) set.finishedAt = patch.finishedAt;
    if (Object.keys(set).length === 0) return;
    await db().update(runs).set(set).where(eq(runs.id, id));
  }

  async getRun(id: string): Promise<Run> {
    const [row] = await db().select().from(runs).where(eq(runs.id, id)).limit(1);
    if (!row) throw new NotFoundError("Run", id);
    return toRun(row);
  }

  async append(e: RunEvent): Promise<void> {
    await db().insert(runEvents).values({
      id: e.id,
      runId: e.runId,
      nodeId: e.nodeId ?? null,
      type: e.type,
      input: e.input ?? null,
      output: e.output ?? null,
      error: e.error ?? null,
      ts: e.ts,
    });
  }

  async listEvents(runId: string): Promise<RunEvent[]> {
    const rows = await db()
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(runEvents.ts);
    return rows.map(toEvent);
  }

  async query(f: RunQuery): Promise<RunSummary[]> {
    const conds: SQL[] = [];
    if (f.ownerId) conds.push(eq(runs.ownerId, f.ownerId));
    if (f.workflowId) conds.push(eq(runs.workflowId, f.workflowId));
    if (f.status) conds.push(eq(runs.status, f.status));
    if (f.from) conds.push(gte(runs.startedAt, f.from));
    if (f.to) conds.push(lte(runs.startedAt, f.to));

    const rows = await db()
      .select()
      .from(runs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(runs.startedAt))
      .limit(f.limit ?? 200);

    if (rows.length === 0) return [];

    // Single grouped aggregate for step counts across all matched runs.
    const runIds = rows.map((r) => r.id);
    const counts = await db()
      .select({ runId: runEvents.runId, c: count() })
      .from(runEvents)
      .where(and(inArray(runEvents.runId, runIds), eq(runEvents.type, "node.executed")))
      .groupBy(runEvents.runId);
    const stepByRun = new Map(counts.map((c) => [c.runId, Number(c.c)]));

    return rows.map((r) => ({
      runId: r.id,
      workflowId: r.workflowId,
      status: r.status as RunStatus,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      stepCount: stepByRun.get(r.id) ?? 0,
    }));
  }
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
    ownerId: r.ownerId,
    workflowId: r.workflowId,
    versionId: r.versionId,
    status: r.status as RunStatus,
    trigger: r.trigger,
    workflowRunId: r.workflowRunId,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
  };
}

function toEvent(r: EventRow): RunEvent {
  return {
    id: r.id,
    runId: r.runId,
    nodeId: r.nodeId,
    type: r.type,
    input: r.input,
    output: r.output,
    error: r.error,
    ts: r.ts,
  };
}
