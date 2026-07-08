import { customType, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Edge, Node, TriggerConfig } from "../../domain/types";

/** Postgres `bytea` column type for encrypted credential payloads. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
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
    byWorkflow: index("wv_workflow_idx").on(t.workflowId),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
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

export const eventSubscriptions = pgTable(
  "event_subscriptions",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    workflowId: text("workflow_id").notNull(),
  },
  (t) => ({
    byEventType: index("subs_event_type_idx").on(t.eventType),
  }),
);
