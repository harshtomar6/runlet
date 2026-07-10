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
  secretKeys: string[]; // field NAMES of the secret (not values) — so you know what to reference as {{ $secret.<key> }}
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

export interface ApiKey {
  id: string;
  ownerId: string;
  name: string;
  prefix: string; // non-secret display prefix, e.g. "ak_a1b2c3"
  keyHash: string; // sha256 hex of the full key
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export interface ApiKeyMeta {
  id: string;
  ownerId: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/** A stored conversation turn (AI memory). */
export interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * An OAuth-established link to an external account (Slack workspace, Google
 * account, …). Tokens are stored encrypted; the other fields stay queryable
 * (e.g. `accountId` routes inbound events to the right owner). Owner-scoped.
 */
export interface Connection {
  id: string;
  ownerId: string;
  provider: string; // "slack" | "google" | ...
  accountId: string; // team_id / email — provider account identity + inbound routing key
  label: string; // human name (workspace / email) for display
  scopes: string[];
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null; // null = non-expiring (e.g. Slack bot token)
  raw: Record<string, unknown>; // provider extras (bot_user_id, incoming_webhook, …)
  createdAt: Date;
  updatedAt: Date;
}

/** Connection without secrets — safe to return from the API. */
export interface ConnectionMeta {
  id: string;
  ownerId: string;
  provider: string;
  accountId: string;
  label: string;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
}
