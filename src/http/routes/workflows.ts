import { Hono } from "hono";
import { z } from "zod";
import { ActivateSchema, CreateWorkflowSchema, UpdateWorkflowSchema } from "../../domain/schemas";
import { ApiError } from "../../errors";
import { dispatcher } from "../../engine/dispatch";
import { scheduleManager } from "../../engine/schedule";
import { WorkflowService } from "../../services/workflow-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new WorkflowService(store, scheduleManager);

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
  const versionId = await service.executableVersionId(c.get("ownerId"), id);
  const { runId } = await dispatcher.start({ workflowId: id, versionId, trigger });
  return ok(c, { runId }, {}, 202);
});
