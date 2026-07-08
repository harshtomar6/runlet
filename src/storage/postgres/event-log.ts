import { and, count, desc, eq, gte, lte } from "drizzle-orm";
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
    const conds = [];
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

    // TODO(M5): replace the per-run count with a single grouped aggregate.
    const summaries: RunSummary[] = [];
    for (const r of rows) {
      const [agg] = await db()
        .select({ c: count() })
        .from(runEvents)
        .where(and(eq(runEvents.runId, r.id), eq(runEvents.type, "node.executed")));
      summaries.push({
        runId: r.id,
        workflowId: r.workflowId,
        status: r.status as RunStatus,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        stepCount: Number(agg?.c ?? 0),
      });
    }
    return summaries;
  }
}

function toRun(r: RunRow): Run {
  return {
    id: r.id,
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
