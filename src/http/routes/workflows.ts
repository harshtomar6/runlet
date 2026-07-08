import { Hono } from "hono";
import { ActivateSchema, CreateWorkflowSchema, UpdateWorkflowSchema } from "../../domain/schemas";
import type { WorkflowStatus } from "../../domain/types";
import { WorkflowService } from "../../services/workflow-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new WorkflowService(store);

export const workflows = new Hono<AppEnv>();
workflows.use("*", auth);

workflows.post("/", async (c) => {
  const input = await parseBody(c, CreateWorkflowSchema);
  const res = await service.create(c.get("ownerId"), input);
  return ok(c, res, {}, 201);
});

workflows.get("/", async (c) => {
  const status = c.req.query("status") as WorkflowStatus | undefined;
  const q = c.req.query("q");
  const list = await service.list(c.get("ownerId"), { status, q });
  return ok(c, list);
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
  const versions = await service.listVersions(c.get("ownerId"), c.req.param("id"));
  return ok(c, versions);
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
