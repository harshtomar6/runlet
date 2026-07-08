import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Edge, Node, TriggerConfig } from "../../domain/types";

/**
 * Postgres `bytea` column type for encrypted credential payloads.
 *
 * Must be driver-agnostic: postgres.js (TCP) returns bytea as a Buffer, but the
 * Neon HTTP driver returns it as a hex string ("\\x0a1b…"). Normalise reads back
 * to a Buffer so the credential store's decrypt path works under both drivers.
 */
/** Normalise a driver's `bytea` representation to a Buffer (see `bytea` below). */
export function byteaFromDriver(value: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  // Neon HTTP driver: hex-encoded, prefixed with "\x".
  return Buffer.from(value.startsWith("\\x") ? value.slice(2) : value, "hex");
}

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array | string }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver: byteaFromDriver,
});

export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  activeVersionId: text("active_version_id"),
  trigger: jsonb("trigger").$type<TriggerConfig>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: text("id").primaryKey(),
    workflowId: text("workflow_id").notNull(),
    version: integer("version").notNull(),
    nodes: jsonb("nodes").$type<Node[]>().notNull(),
    edges: jsonb("edges").$type<Edge[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Enforces "version is monotonic per workflow" (DESIGN §4) and prevents
    // duplicate version numbers from concurrent/buggy createVersion calls.
    // The composite also serves workflow_id prefix lookups.
    byWorkflowVersion: uniqueIndex("wv_workflow_version_uidx").on(t.workflowId, t.version),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(""),
    workflowId: text("workflow_id").notNull(),
    versionId: text("version_id").notNull(),
    status: text("status").notNull().default("running"),
    trigger: jsonb("trigger"),
    workflowRunId: text("workflow_run_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    byWorkflow: index("runs_workflow_idx").on(t.workflowId),
    byOwner: index("runs_owner_idx").on(t.ownerId),
    byStatus: index("runs_status_idx").on(t.status),
  }),
);

export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    nodeId: text("node_id"),
    type: text("type").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    error: jsonb("error"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byRun: index("run_events_run_idx").on(t.runId),
  }),
);

export const credentials = pgTable("credentials", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  type: text("type").notNull(),
  ciphertext: bytea("ciphertext").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    byOwner: index("api_keys_owner_idx").on(t.ownerId),
  }),
);

export const eventSubscriptions = pgTable(
  "event_subscriptions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    eventType: text("event_type").notNull(),
    workflowId: text("workflow_id").notNull(),
  },
  (t) => ({
    byOwnerEventType: index("subs_owner_event_type_idx").on(t.ownerId, t.eventType),
    byWorkflow: index("subs_workflow_idx").on(t.workflowId),
  }),
);
