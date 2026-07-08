import type { Run, RunEvent, RunStatus } from "../domain/types";
import { parseDuration } from "../engine/duration";
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
  successRate: number; // succeeded / total (0 when total === 0)
}

/** Read model over runs + events, owner-scoped. */
export class RunService {
  constructor(private readonly store: Store) {}

  async list(
    ownerId: string,
    filter: { workflowId?: string; status?: RunStatus; limit?: number; from?: Date; to?: Date },
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

  async metrics(ownerId: string, filter: { workflowId?: string; window?: string }): Promise<Metrics> {
    // window like "24h" / "7d" → lower bound on startedAt.
    let from: Date | undefined;
    if (filter.window) {
      let seconds: number;
      try {
        seconds = parseDuration(filter.window);
      } catch {
        throw new ApiError(400, "invalid_window", `Invalid window: "${filter.window}" (e.g. 24h, 7d)`);
      }
      from = new Date(Date.now() - seconds * 1000);
    }
    // SQL-side aggregate over ALL matching runs (no capped fetch).
    const m = await this.store.events.metrics({ ownerId, workflowId: filter.workflowId, from });
    const succeeded = m.byStatus.succeeded ?? 0;
    const successRate = m.total > 0 ? succeeded / m.total : 0;
    return { ...m, successRate };
  }
}
