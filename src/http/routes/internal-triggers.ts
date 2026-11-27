import { Hono } from "hono";
import { env } from "../../config/env";
import { dispatcher } from "../../engine/dispatch";
import { ApiError } from "../../errors";
import { TriggerService } from "../../services/trigger-service";
import { store } from "../../storage/factory";
import { ok } from "../lib/respond";
import { secretEquals } from "../lib/signature";
import type { AppEnv } from "../types";

const triggers = new TriggerService(store, dispatcher);

/** Internal endpoints hit by QStash schedules. Guarded by INTERNAL_SECRET. */
export const internalTriggers = new Hono<AppEnv>();

internalTriggers.post("/tick/:workflowId", async (c) => {
  // Fail closed: this endpoint starts runs by workflow id, so it must never be
  // publicly callable. If no secret is configured, reject outright.
  if (!env.INTERNAL_SECRET) {
    throw new ApiError(503, "internal_secret_unset", "INTERNAL_SECRET is not configured");
  }
  if (!secretEquals(c.req.header("x-internal-secret"), env.INTERNAL_SECRET)) {
    throw new ApiError(401, "unauthorized", "Invalid internal secret");
  }
  const { runId } = await triggers.runWorkflowNow(c.req.param("workflowId"), {
    scheduledAt: new Date().toISOString(),
  });
  return ok(c, { runId }, {}, 202);
});
