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

const service = new SubscriptionService(store, new TriggerService(store, dispatcher));

const CreateSubscriptionSchema = z.object({
  eventType: z.string().min(1),
  workflowId: z.string().min(1),
});

export const subscriptions = new Hono<AppEnv>();
subscriptions.use("*", auth);

subscriptions.post("/", async (c) => {
  const input = await parseBody(c, CreateSubscriptionSchema);
  const sub = await service.create(c.get("ownerId"), input);
  return ok(c, sub, {}, 201);
});

subscriptions.get("/", async (c) => ok(c, await service.list(c.get("ownerId"))));

subscriptions.delete("/:id", async (c) => {
  await service.remove(c.get("ownerId"), c.req.param("id"));
  return ok(c, { deleted: true });
});
