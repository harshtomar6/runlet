import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "../config/env";
import { engineRoute } from "../engine/upstash";
import { onError } from "./middleware/error";
import { requestId } from "./middleware/request-id";
import { events } from "./routes/events";
import { health } from "./routes/health";
import { hooks } from "./routes/hooks";
import { apiKeys } from "./routes/api-keys";
import { approvals } from "./routes/approvals";
import { connections } from "./routes/connections";
import { credentials } from "./routes/credentials";
import { oauth } from "./routes/oauth";
import { internalTriggers } from "./routes/internal-triggers";
import { llms } from "./routes/llms";
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

  // CORS for browser clients. Auth is a bearer token (not cookies), so "*" is
  // safe by default; restrict via CORS_ORIGINS. Handles OPTIONS preflight.
  const origins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : "*";
  app.use(
    "*",
    cors({
      origin: origins,
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "x-api-key", "x-signature"],
      maxAge: 86400,
    }),
  );

  app.onError(onError);

  app.get("/", (c) => c.json({ name: "runlet", version: "0.1.0", llms: "/llms.txt" }));
  app.route("/health", health);
  app.route("/llms.txt", llms); // public LLM build guide (llmstxt.org)
  app.route("/node-types", nodeTypes); // public catalog
  app.route("/workflows", workflows); // authed (x-owner-id)
  app.route("/events", events); // authed app event ingress
  app.route("/subscriptions", subscriptions); // authed event→workflow routing
  app.route("/runs", runs); // authed run observability
  app.route("/metrics", metrics); // authed aggregate metrics
  app.route("/credentials", credentials); // authed encrypted secrets
  app.route("/connections", connections); // authed OAuth connections
  app.route("/oauth", oauth); // OAuth flow (start authed; callback public)
  app.route("/api-keys", apiKeys); // authed API-key management
  app.route("/approvals", approvals); // authed human-approval delivery
  app.route("/hooks", hooks); // public webhook entrypoint (optional HMAC)
  app.route("/triggers", internalTriggers); // internal schedule ticks (secret)

  // Durable engine endpoint (QStash-invoked). The Upstash Hono adapter expects
  // WorkflowBindings; our app supplies them from env at runtime.
  app.post("/engine", (c) => engineRoute(c as never));

  return app;
}
