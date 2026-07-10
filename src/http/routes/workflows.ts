import { Hono } from "hono";
import { z } from "zod";
import {
  ActivateSchema,
  CreateWorkflowSchema,
  EdgeSchema,
  NodeSchema,
  TriggerConfigSchema,
  UpdateWorkflowSchema,
} from "../../domain/schemas";
import { ApiError } from "../../errors";
import { defaultConnectors } from "../../connectors/default";
import { dispatcher } from "../../engine/dispatch";
import { scheduleManager } from "../../engine/schedule";
import { buildNodeResolver } from "../../nodes/custom";
import { DryRunService } from "../../services/dry-run-service";
import { NodeTestService } from "../../services/node-test-service";
import { validateGraph } from "../../services/validation";
import { WorkflowService } from "../../services/workflow-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new WorkflowService(store, scheduleManager);
const nodeTests = new NodeTestService(store, defaultConnectors());
const dryRuns = new DryRunService(store);

// Stateless graph body (no name/persistence) — for validate & dry-run.
const GraphSchema = z.object({
  trigger: TriggerConfigSchema,
  nodes: z.array(NodeSchema).default([]),
  edges: z.array(EdgeSchema).default([]),
});
const DryRunSchema = GraphSchema.extend({ input: z.unknown().optional() });

const TestNodeSchema = z.object({
  nodeId: z.string().min(1),
  sampleInput: z.unknown().optional(),
  versionId: z.string().optional(),
  dryRun: z.boolean().optional(), // default true — real side effects only on explicit opt-in
});

const StatusSchema = z.enum(["draft", "active", "disabled"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function pageLimit(raw: string | undefined): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export const workflows = new Hono<AppEnv>();
workflows.use("*", auth);

workflows.post("/", async (c) => {
  const input = await parseBody(c, CreateWorkflowSchema);
  const res = await service.create(c.get("ownerId"), input);
  return ok(c, res, {}, 201);
});

// Stateless validation — no draft to create first (tight loop for builders/agents).
workflows.post("/validate", async (c) => {
  const input = await parseBody(c, GraphSchema);
  const resolve = await buildNodeResolver(store, c.get("ownerId"));
  return ok(c, validateGraph(input, resolve));
});

// Simulate the whole graph with NO side effects — returns every node's output +
// the event timeline (or the error + partial trace). The "does it run" check.
workflows.post("/dry-run", async (c) => {
  const input = await parseBody(c, DryRunSchema);
  return ok(c, await dryRuns.run(c.get("ownerId"), input));
});

workflows.get("/", async (c) => {
  const rawStatus = c.req.query("status");
  let status: z.infer<typeof StatusSchema> | undefined;
  if (rawStatus !== undefined) {
    const parsed = StatusSchema.safeParse(rawStatus);
    if (!parsed.success) throw new ApiError(400, "invalid_status", `Invalid status: "${rawStatus}"`);
    status = parsed.data;
  }
  const q = c.req.query("q");
  const limit = pageLimit(c.req.query("limit"));
  const cursor = c.req.query("cursor");

  const list = await service.list(c.get("ownerId"), { status, q, limit, cursor });
  const nextCursor = list.length === limit ? list[list.length - 1]?.id : undefined;
  return ok(c, list, nextCursor ? { cursor: nextCursor } : {});
});

workflows.get("/:id", async (c) => {
  const wf = await service.get(c.get("ownerId"), c.req.param("id"));
  return ok(c, wf);
});

workflows.put("/:id", async (c) => {
  const input = await parseBody(c, UpdateWorkflowSchema);
  const version = await service.update(c.get("ownerId"), c.req.param("id"), input);
  return ok(c, version, {}, 201);
});

workflows.delete("/:id", async (c) => {
  await service.remove(c.get("ownerId"), c.req.param("id"));
  return ok(c, { deleted: true });
});

workflows.get("/:id/versions", async (c) => {
  const all = await service.listVersions(c.get("ownerId"), c.req.param("id")); // newest first
  const limit = pageLimit(c.req.query("limit"));
  const cursor = c.req.query("cursor");
  const start = cursor ? all.findIndex((v) => v.id === cursor) + 1 : 0;
  const page = all.slice(start, start + limit);
  const nextCursor = start + limit < all.length ? page[page.length - 1]?.id : undefined;
  return ok(c, page, nextCursor ? { cursor: nextCursor } : {});
});

workflows.post("/:id/test-node", async (c) => {
  const input = await parseBody(c, TestNodeSchema);
  const outcome = await nodeTests.testNode(c.get("ownerId"), c.req.param("id"), input);
  return ok(c, outcome);
});

workflows.post("/:id/validate", async (c) => {
  const versionId = c.req.query("versionId") ?? undefined;
  const result = await service.validate(c.get("ownerId"), c.req.param("id"), versionId);
  return ok(c, result);
});

workflows.post("/:id/activate", async (c) => {
  const { versionId } = await parseBody(c, ActivateSchema);
  await service.activate(c.get("ownerId"), c.req.param("id"), versionId);
  return ok(c, { activated: versionId });
});

workflows.post("/:id/disable", async (c) => {
  await service.disable(c.get("ownerId"), c.req.param("id"));
  return ok(c, { disabled: true });
});

// Manual run. Dispatch mode (local vs qstash) is env-controlled.
workflows.post("/:id/execute", async (c) => {
  const id = c.req.param("id");
  const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const trigger = "input" in raw ? raw.input : raw;
  const ownerId = c.get("ownerId");
  const versionId = await service.executableVersionId(ownerId, id);
  const { runId } = await dispatcher.start({ ownerId, workflowId: id, versionId, trigger });
  return ok(c, { runId }, {}, 202);
});
