import type {
  CredentialMeta,
  DecryptedSecret,
  EventSubscription,
  Run,
  RunEvent,
  Workflow,
  WorkflowStatus,
  WorkflowVersion,
} from "../../domain/types";
import { NotFoundError } from "../../ports/errors";
import type {
  CredentialStore,
  EventLog,
  PutCredentialInput,
  RunQuery,
  RunSummary,
  Store,
  SubscriptionRepo,
  WorkflowFilter,
  WorkflowRepo,
} from "../../ports";
import { MemoryKVState } from "./kv-state";

/** Full in-memory Store for tests and demos. No persistence, no I/O. */
export class MemoryStore implements Store {
  readonly kv = new MemoryKVState();
  readonly workflows: WorkflowRepo;
  readonly events: EventLog;
  readonly credentials: CredentialStore;
  readonly subscriptions: SubscriptionRepo;

  private readonly wf = new Map<string, Workflow>();
  private readonly versions = new Map<string, WorkflowVersion>();
  private readonly runs = new Map<string, Run>();
  private readonly runEvents: RunEvent[] = [];
  private readonly creds = new Map<string, { meta: CredentialMeta; secret: Record<string, unknown> }>();
  private readonly subs = new Map<string, EventSubscription>();

  constructor() {
    const self = this;
    this.workflows = {
      async getWorkflow(id) {
        const w = self.wf.get(id);
        if (!w) throw new NotFoundError("Workflow", id);
        return w;
      },
      async list(ownerId, filter?: WorkflowFilter) {
        return [...self.wf.values()].filter(
          (w) => w.ownerId === ownerId && (!filter?.status || w.status === filter.status),
        );
      },
      async setStatus(id, status: WorkflowStatus) {
        const w = self.wf.get(id);
        if (w) w.status = status;
      },
      async putWorkflow(w) {
        self.wf.set(w.id, { ...w });
      },
      async getVersion(workflowId, versionId) {
        const v = self.versions.get(versionId);
        if (!v || v.workflowId !== workflowId) throw new NotFoundError("WorkflowVersion", versionId);
        return v;
      },
      async listVersions(workflowId) {
        return [...self.versions.values()]
          .filter((v) => v.workflowId === workflowId)
          .sort((a, b) => b.version - a.version);
      },
      async createVersion(v) {
        self.versions.set(v.id, { ...v });
      },
      async activate(workflowId, versionId) {
        const w = self.wf.get(workflowId);
        if (w) {
          w.activeVersionId = versionId;
          w.status = "active";
        }
      },
    };

    this.events = {
      async createRun(r) {
        self.runs.set(r.id, { ...r });
      },
      async updateRun(id, patch) {
        const r = self.runs.get(id);
        if (r) Object.assign(r, patch);
      },
      async getRun(id) {
        const r = self.runs.get(id);
        if (!r) throw new NotFoundError("Run", id);
        return r;
      },
      async append(e) {
        self.runEvents.push(e);
      },
      async listEvents(runId) {
        return self.runEvents.filter((e) => e.runId === runId);
      },
      async query(f: RunQuery) {
        return [...self.runs.values()]
          .filter(
            (r) =>
              (!f.ownerId || r.ownerId === f.ownerId) &&
              (!f.workflowId || r.workflowId === f.workflowId) &&
              (!f.status || r.status === f.status),
          )
          .map<RunSummary>((r) => ({
            runId: r.id,
            workflowId: r.workflowId,
            status: r.status,
            startedAt: r.startedAt,
            finishedAt: r.finishedAt,
            stepCount: self.runEvents.filter((e) => e.runId === r.id && e.type === "node.executed").length,
          }));
      },
      async metrics(f: RunQuery) {
        const matched = [...self.runs.values()].filter(
          (r) =>
            (!f.ownerId || r.ownerId === f.ownerId) &&
            (!f.workflowId || r.workflowId === f.workflowId) &&
            (!f.status || r.status === f.status) &&
            (!f.from || r.startedAt >= f.from) &&
            (!f.to || r.startedAt <= f.to),
        );
        const byStatus: Record<string, number> = {};
        for (const r of matched) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
        const ids = new Set(matched.map((r) => r.id));
        const totalSteps = self.runEvents.filter(
          (e) => e.type === "node.executed" && ids.has(e.runId),
        ).length;
        return { total: matched.length, byStatus, totalSteps };
      },
    };

    this.credentials = {
      async get(id): Promise<DecryptedSecret> {
        const c = self.creds.get(id);
        if (!c) throw new NotFoundError("Credential", id);
        return { id, type: c.meta.type, secret: c.secret };
      },
      async put(input: PutCredentialInput) {
        self.creds.set(input.id, {
          meta: { id: input.id, ownerId: input.ownerId, type: input.type, createdAt: new Date() },
          secret: input.secret,
        });
      },
      async list(ownerId) {
        return [...self.creds.values()].filter((c) => c.meta.ownerId === ownerId).map((c) => c.meta);
      },
      async delete(id) {
        self.creds.delete(id);
      },
    };

    this.subscriptions = {
      async create(s) {
        self.subs.set(s.id, { ...s });
      },
      async delete(id, ownerId) {
        const s = self.subs.get(id);
        if (s && s.ownerId === ownerId) self.subs.delete(id);
      },
      async listByOwner(ownerId) {
        return [...self.subs.values()].filter((s) => s.ownerId === ownerId);
      },
      async listByOwnerAndEventType(ownerId, eventType) {
        return [...self.subs.values()].filter((s) => s.ownerId === ownerId && s.eventType === eventType);
      },
      async listByWorkflow(workflowId) {
        return [...self.subs.values()].filter((s) => s.workflowId === workflowId);
      },
    };
  }
}
