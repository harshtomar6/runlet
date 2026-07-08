import { Hono } from "hono";
import type { RunStatus } from "../../domain/types";
import { RunService } from "../../services/run-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new RunService(store);

export const runs = new Hono<AppEnv>();
runs.use("*", auth);

runs.get("/", async (c) => {
  const owner = c.get("ownerId");
  const workflowId = c.req.query("workflowId");
  const status = c.req.query("status") as RunStatus | undefined;
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
  return ok(c, await service.list(owner, { workflowId, status, limit }));
});

runs.get("/:id", async (c) => ok(c, await service.get(c.get("ownerId"), c.req.param("id"))));

runs.get("/:id/events", async (c) => ok(c, await service.events(c.get("ownerId"), c.req.param("id"))));

runs.post("/:id/cancel", async (c) => {
  await service.cancel(c.get("ownerId"), c.req.param("id"));
  return ok(c, { cancelled: true });
});
