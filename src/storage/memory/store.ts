import type {
  ApiKey,
  Connection,
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
  ApiKeyRepo,
  ConnectionStore,
  ConversationStore,
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
import { MemoryConversationStore } from "./conversation-store";
import { MemoryKVState } from "./kv-state";

/** Full in-memory Store for tests and demos. No persistence, no I/O. */
export class MemoryStore implements Store {
  readonly kv = new MemoryKVState();
  readonly conversations: ConversationStore = new MemoryConversationStore();
  readonly workflows: WorkflowRepo;
  readonly events: EventLog;
  readonly credentials: CredentialStore;
  readonly connections: ConnectionStore;
  readonly subscriptions: SubscriptionRepo;
  readonly apiKeys: ApiKeyRepo;

  private readonly wf = new Map<string, Workflow>();
  private readonly versions = new Map<string, WorkflowVersion>();
  private readonly runs = new Map<string, Run>();
  private readonly runEvents: RunEvent[] = [];
  private readonly creds = new Map<
    string,
    { meta: Omit<CredentialMeta, "secretKeys">; secret: Record<string, unknown> }
  >();
  private readonly conns = new Map<string, Connection>();
  private readonly subs = new Map<string, EventSubscription>();
  private readonly keys = new Map<string, ApiKey>();

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
      async get(id, ownerId): Promise<DecryptedSecret> {
        const c = self.creds.get(id);
        if (!c || c.meta.ownerId !== ownerId) throw new NotFoundError("Credential", id);
        return { id, type: c.meta.type, secret: c.secret };
      },
      async put(input: PutCredentialInput) {
        self.creds.set(input.id, {
          meta: { id: input.id, ownerId: input.ownerId, type: input.type, createdAt: new Date() },
          secret: input.secret,
        });
      },
      async list(ownerId) {
        return [...self.creds.values()]
          .filter((c) => c.meta.ownerId === ownerId)
          .map((c) => ({ ...c.meta, secretKeys: Object.keys(c.secret) }));
      },
      async delete(id, ownerId) {
        const c = self.creds.get(id);
        if (!c || c.meta.ownerId !== ownerId) return false;
        self.creds.delete(id);
        return true;
      },
    };

    this.connections = {
      async upsert(input) {
        const now = new Date();
        // Emulate the unique(ownerId, provider, accountId) upsert.
        const existing = [...self.conns.values()].find(
          (c) => c.ownerId === input.ownerId && c.provider === input.provider && c.accountId === input.accountId,
        );
        const conn: Connection = {
          id: existing?.id ?? input.id,
          ownerId: input.ownerId,
          provider: input.provider,
          accountId: input.accountId,
          label: input.label,
          scopes: input.scopes,
          accessToken: input.accessToken,
          refreshToken: input.refreshToken,
          expiresAt: input.expiresAt,
          raw: input.raw ?? {},
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        self.conns.set(conn.id, conn);
        return conn;
      },
      async get(id, ownerId) {
        const c = self.conns.get(id);
        if (!c || c.ownerId !== ownerId) throw new NotFoundError("Connection", id);
        return c;
      },
      async listByOwner(ownerId) {
        return [...self.conns.values()]
          .filter((c) => c.ownerId === ownerId)
          .map(({ accessToken: _a, refreshToken: _r, raw: _raw, updatedAt: _u, ...meta }) => meta);
      },
      async delete(id, ownerId) {
        const c = self.conns.get(id);
        if (!c || c.ownerId !== ownerId) return null;
        self.conns.delete(id);
        return c;
      },
      async updateTokens(id, patch) {
        const c = self.conns.get(id);
        if (!c) throw new NotFoundError("Connection", id);
        if (patch.accessToken !== undefined) c.accessToken = patch.accessToken;
        if (patch.refreshToken !== undefined) c.refreshToken = patch.refreshToken;
        if (patch.expiresAt !== undefined) c.expiresAt = patch.expiresAt;
        if (patch.scopes) c.scopes = patch.scopes;
        if (patch.raw) c.raw = patch.raw;
        c.updatedAt = new Date();
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

    this.apiKeys = {
      async create(k) {
        self.keys.set(k.id, { ...k });
      },
      async findByHash(keyHash) {
        return [...self.keys.values()].find((k) => k.keyHash === keyHash) ?? null;
      },
      async listByOwner(ownerId) {
        return [...self.keys.values()]
          .filter((k) => k.ownerId === ownerId)
          .map(({ keyHash: _keyHash, ...meta }) => meta);
      },
      async revoke(id, ownerId) {
        const k = self.keys.get(id);
        if (k && k.ownerId === ownerId) k.revokedAt = new Date();
      },
    };
  }
}
