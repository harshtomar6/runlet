import { Hono } from "hono";
import { engineRoute } from "../engine/upstash";
import { onError } from "./middleware/error";
import { requestId } from "./middleware/request-id";
import { events } from "./routes/events";
import { health } from "./routes/health";
import { hooks } from "./routes/hooks";
import { apiKeys } from "./routes/api-keys";
import { approvals } from "./routes/approvals";
import { credentials } from "./routes/credentials";
import { internalTriggers } from "./routes/internal-triggers";
import { metrics } from "./routes/metrics";
import { nodeTypes } from "./routes/node-types";
import { runs } from "./routes/runs";
import { subscriptions } from "./routes/subscriptions";
import { workflows } from "./routes/workflows";
import type { AppEnv } from "./types";

/**
 * Builds the HTTP app. Runs/observability and trigger routes are added in
 * later milestones (see DESIGN.md §12).
 */
export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId);
  app.onError(onError);

  app.get("/", (c) => c.json({ name: "runlet", version: "0.1.0" }));
  app.route("/health", health);
  app.route("/node-types", nodeTypes); // public catalog
  app.route("/workflows", workflows); // authed (x-owner-id)
  app.route("/events", events); // authed app event ingress
  app.route("/subscriptions", subscriptions); // authed event→workflow routing
  app.route("/runs", runs); // authed run observability
  app.route("/metrics", metrics); // authed aggregate metrics
  app.route("/credentials", credentials); // authed encrypted secrets
  app.route("/api-keys", apiKeys); // authed API-key management
  app.route("/approvals", approvals); // authed human-approval delivery
  app.route("/hooks", hooks); // public webhook entrypoint (optional HMAC)
  app.route("/triggers", internalTriggers); // internal schedule ticks (secret)

  // Durable engine endpoint (QStash-invoked). The Upstash Hono adapter expects
  // WorkflowBindings; our app supplies them from env at runtime.
  app.post("/engine", (c) => engineRoute(c as never));

  return app;
}
