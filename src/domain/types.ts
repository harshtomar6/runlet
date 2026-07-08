/**
 * Core domain model. Mirrors DESIGN.md §4. These are storage-agnostic shapes;
 * adapters map their rows/records to and from these.
 */

export type WorkflowStatus = "draft" | "active" | "disabled";

export interface Position {
  x: number;
  y: number;
}

export interface Node {
  id: string;
  type: string; // registry key, e.g. "email.send"
  params: Record<string, unknown>;
  position?: Position; // UI-only; the engine ignores it
}

export interface NodePort {
  nodeId: string;
  port: string; // e.g. "out" | "success" | "true"
}

export interface Edge {
  from: NodePort;
  to: NodePort;
}

export type TriggerType = "webhook" | "schedule" | "event" | "manual";

export interface TriggerConfig {
  type: TriggerType;
  eventType?: string; // for type === "event"
  cron?: string; // for type === "schedule"
}

export interface Workflow {
  id: string;
  ownerId: string;
  name: string;
  status: WorkflowStatus;
  activeVersionId: string | null;
  trigger: TriggerConfig;
  createdAt: Date;
  updatedAt: Date;
}

/** Immutable once created. Editing a workflow creates a new version. */
export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number; // monotonic per workflow
  nodes: Node[];
  edges: Edge[];
  createdAt: Date;
}

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface Run {
  id: string;
  ownerId: string;
  workflowId: string;
  versionId: string; // PINNED at start
  status: RunStatus;
  trigger: unknown; // input payload
  workflowRunId: string | null; // Upstash ctx.workflowRunId (correlation)
  startedAt: Date;
  finishedAt: Date | null;
}

export type RunEventType =
  | "run.started"
  | "node.started"
  | "node.executed"
  | "node.failed"
  | "run.succeeded"
  | "run.failed"
  // domain.* and future event types
  | (string & {});

export interface RunEvent {
  id: string;
  runId: string;
  nodeId?: string | null;
  type: RunEventType;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  ts: Date;
}

export interface CredentialMeta {
  id: string;
  ownerId: string;
  type: string; // "resend" | "slack" | "http_bearer" ...
  createdAt: Date;
}

/** Returned by CredentialStore.get — decrypted, never leaves the engine. */
export interface DecryptedSecret {
  id: string;
  type: string;
  secret: Record<string, unknown>;
}

export interface EventSubscription {
  id: string;
  ownerId: string;
  eventType: string;
  workflowId: string;
}
