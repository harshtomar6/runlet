import type {
  CredentialMeta,
  DecryptedSecret,
  EventSubscription,
  Run,
  RunEvent,
  RunStatus,
  Workflow,
  WorkflowStatus,
  WorkflowVersion,
} from "../domain/types";

/**
 * Storage ports. The engine and services depend only on these interfaces;
 * concrete adapters live under src/storage. Keep methods capability-minimal
 * and designed around the queries we actually run (see DESIGN.md §5).
 */

export interface WorkflowFilter {
  status?: WorkflowStatus;
  q?: string;
  limit?: number;
  cursor?: string; // exclusive: return items with id < cursor (ids sort by time)
}

export interface WorkflowRepo {
  getWorkflow(id: string): Promise<Workflow>;
  list(ownerId: string, filter?: WorkflowFilter): Promise<Workflow[]>;
  setStatus(id: string, status: WorkflowStatus): Promise<void>;

  getVersion(workflowId: string, versionId: string): Promise<WorkflowVersion>;
  listVersions(workflowId: string): Promise<WorkflowVersion[]>; // newest first
  createVersion(v: WorkflowVersion): Promise<void>; // immutable
  activate(workflowId: string, versionId: string): Promise<void>; // atomic

  // Upsert the workflow header (create-or-replace core fields).
  putWorkflow(w: Workflow): Promise<void>;
}

export interface RunQuery {
  ownerId?: string;
  workflowId?: string;
  status?: RunStatus;
  from?: Date;
  to?: Date;
  limit?: number;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  stepCount: number;
}

export interface RunMetrics {
  total: number;
  byStatus: Record<string, number>;
  totalSteps: number;
}

export interface EventLog {
  createRun(r: Run): Promise<void>;
  updateRun(id: string, patch: Partial<Run>): Promise<void>;
  getRun(id: string): Promise<Run>;

  append(e: RunEvent): Promise<void>;
  listEvents(runId: string): Promise<RunEvent[]>; // run-detail timeline

  /** Analytics-shaped. A non-relational adapter may throw UnsupportedOperation. */
  query(f: RunQuery): Promise<RunSummary[]>;

  /** SQL-side aggregate over ALL matching runs (not a capped fetch). */
  metrics(f: RunQuery): Promise<RunMetrics>;
}

export interface PutCredentialInput {
  id: string;
  ownerId: string;
  type: string;
  secret: Record<string, unknown>; // encrypted inside the adapter
}

export interface CredentialStore {
  get(id: string): Promise<DecryptedSecret>; // decrypts internally
  put(input: PutCredentialInput): Promise<void>; // encrypts internally
  list(ownerId: string): Promise<CredentialMeta[]>; // metadata only
  delete(id: string): Promise<void>;
}

export interface KVState {
  setNX(key: string, val: string, ttlSec: number): Promise<boolean>; // locks / dedup
  set(key: string, val: string, ttlSec?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  incr(key: string, ttlSec?: number): Promise<number>; // rate-limit counters (ttl set on first incr)
  del(key: string): Promise<void>;
}

export interface SubscriptionRepo {
  create(s: EventSubscription): Promise<void>;
  delete(id: string, ownerId: string): Promise<void>;
  listByOwner(ownerId: string): Promise<EventSubscription[]>;
  listByOwnerAndEventType(ownerId: string, eventType: string): Promise<EventSubscription[]>;
  listByWorkflow(workflowId: string): Promise<EventSubscription[]>;
}

export interface Store {
  workflows: WorkflowRepo;
  events: EventLog;
  credentials: CredentialStore;
  subscriptions: SubscriptionRepo;
  kv: KVState;
}
