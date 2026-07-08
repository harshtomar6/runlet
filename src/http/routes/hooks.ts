import { Hono } from "hono";
import { env } from "../../config/env";
import { dispatcher } from "../../engine/dispatch";
import { ApiError } from "../../errors";
import { TriggerService } from "../../services/trigger-service";
import { store } from "../../storage/factory";
import { verifySignature } from "../lib/signature";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const triggers = new TriggerService(store, dispatcher);

/** Public webhook entrypoint. Optionally HMAC-verified via WEBHOOK_SECRET. */
export const hooks = new Hono<AppEnv>();

hooks.post("/:workflowId", async (c) => {
  const raw = await c.req.text();

  if (env.WEBHOOK_SECRET) {
    const sig = c.req.header("x-signature");
    if (!verifySignature(raw, env.WEBHOOK_SECRET, sig)) {
      throw new ApiError(401, "invalid_signature", "Invalid or missing x-signature");
    }
  }

  let body: unknown = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "Webhook body must be valid JSON");
    }
  }

  const { runId } = await triggers.runWorkflowNow(c.req.param("workflowId"), body);
  return ok(c, { runId }, {}, 202);
});
