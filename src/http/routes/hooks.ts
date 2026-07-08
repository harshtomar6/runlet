import { Hono } from "hono";
import { env } from "../../config/env";
import { dispatcher } from "../../engine/dispatch";
import { ApiError } from "../../errors";
import { TriggerService } from "../../services/trigger-service";
import { store } from "../../storage/factory";
import { verifySignature } from "../lib/signature";
import { enforceRateLimit } from "../lib/rate-limit";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const triggers = new TriggerService(store, dispatcher);
const HOOK_LIMIT_PER_MIN = 60;

/** Public webhook entrypoint. HMAC-verified via WEBHOOK_SECRET (required in prod). */
export const hooks = new Hono<AppEnv>();

hooks.post("/:workflowId", async (c) => {
  const workflowId = c.req.param("workflowId");
  await enforceRateLimit(store.kv, `hook:${workflowId}`, HOOK_LIMIT_PER_MIN, 60);

  const raw = await c.req.text();

  if (env.WEBHOOK_SECRET) {
    const sig = c.req.header("x-signature");
    if (!verifySignature(raw, env.WEBHOOK_SECRET, sig)) {
      throw new ApiError(401, "invalid_signature", "Invalid or missing x-signature");
    }
  } else if (env.NODE_ENV === "production") {
    // Fail closed: never accept unsigned webhooks in production.
    throw new ApiError(503, "webhook_secret_unset", "WEBHOOK_SECRET must be set to accept webhooks in production");
  }

  let body: unknown = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "Webhook body must be valid JSON");
    }
  }

  const { runId } = await triggers.runWorkflowNow(workflowId, body);
  return ok(c, { runId }, {}, 202);
});
