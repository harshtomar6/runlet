import { Hono } from "hono";
import { z } from "zod";
import { dispatcher } from "../../engine/dispatch";
import { SubscriptionService } from "../../services/subscription-service";
import { TriggerService } from "../../services/trigger-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const subscriptions = new SubscriptionService(store, new TriggerService(store, dispatcher));

const EventSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown().optional(),
});

/** App event ingress. Fans out to subscribed workflows for the owner. */
export const events = new Hono<AppEnv>();
events.use("*", auth);

events.post("/", async (c) => {
  const input = await parseBody(c, EventSchema);
  const result = await subscriptions.dispatchEvent(c.get("ownerId"), input.type, input.payload ?? {});
  return ok(c, result, {}, 202);
});
