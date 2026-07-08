import { Hono } from "hono";
import { z } from "zod";
import { dispatcher } from "../../engine/dispatch";
import { SubscriptionService } from "../../services/subscription-service";
import { TriggerService } from "../../services/trigger-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { enforceRateLimit } from "../lib/rate-limit";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const subscriptions = new SubscriptionService(store, new TriggerService(store, dispatcher));
const EVENT_LIMIT_PER_MIN = 120;

const EventSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
});

/** App event ingress. Fans out to subscribed workflows for the owner. */
export const events = new Hono<AppEnv>();
events.use("*", auth);

events.post("/", async (c) => {
  const owner = c.get("ownerId");
  const input = await parseBody(c, EventSchema);
  await enforceRateLimit(store.kv, `events:${owner}:${input.type}`, EVENT_LIMIT_PER_MIN, 60);
  const result = await subscriptions.dispatchEvent(owner, input.type, input.payload ?? {});
  return ok(c, result, {}, 202);
});
