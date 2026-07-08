import type { Run, RunEvent, RunStatus } from "../domain/types";
import { ApiError } from "../errors";
import type { RunSummary, Store } from "../ports";

export interface RunDetail {
  run: Run;
  events: RunEvent[];
}

export interface Metrics {
  total: number;
  byStatus: Record<string, number>;
  totalSteps: number;
}

/** Read model over runs + events, owner-scoped. */
export class RunService {
  constructor(private readonly store: Store) {}

  async list(
    ownerId: string,
    filter: { workflowId?: string; status?: RunStatus; limit?: number },
  ): Promise<RunSummary[]> {
    return this.store.events.query({ ownerId, ...filter });
  }

  async get(ownerId: string, runId: string): Promise<RunDetail> {
    const run = await this.store.events.getRun(runId);
    if (run.ownerId !== ownerId) throw new ApiError(404, "not_found", "Run not found");
    const events = await this.store.events.listEvents(runId);
    return { run, events };
  }

  async events(ownerId: string, runId: string): Promise<RunEvent[]> {
    return (await this.get(ownerId, runId)).events;
  }

  async cancel(ownerId: string, runId: string): Promise<void> {
    const run = await this.store.events.getRun(runId);
    if (run.ownerId !== ownerId) throw new ApiError(404, "not_found", "Run not found");
    if (run.status === "running") {
      // Best-effort: marks the record. Durable cancellation via QStash is a TODO.
      await this.store.events.updateRun(runId, { status: "cancelled", finishedAt: new Date() });
    }
  }

  async metrics(ownerId: string, filter: { workflowId?: string }): Promise<Metrics> {
    const summaries = await this.store.events.query({ ownerId, ...filter, limit: 1000 });
    const byStatus: Record<string, number> = {};
    let totalSteps = 0;
    for (const s of summaries) {
      byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      totalSteps += s.stepCount;
    }
    return { total: summaries.length, byStatus, totalSteps };
  }
}
