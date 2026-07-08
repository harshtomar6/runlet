import { Hono } from "hono";
import { RunService } from "../../services/run-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new RunService(store);

export const metrics = new Hono<AppEnv>();
metrics.use("*", auth);

metrics.get("/", async (c) => {
  const workflowId = c.req.query("workflowId");
  const window = c.req.query("window");
  return ok(c, await service.metrics(c.get("ownerId"), { workflowId, window }));
});
