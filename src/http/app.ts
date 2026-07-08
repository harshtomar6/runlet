import { Hono } from "hono";
import { engineRoute } from "../engine/upstash";
import { onError } from "./middleware/error";
import { requestId } from "./middleware/request-id";
import { health } from "./routes/health";
import { nodeTypes } from "./routes/node-types";
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

  app.get("/", (c) => c.json({ name: "app-automations", version: "0.1.0" }));
  app.route("/health", health);
  app.route("/node-types", nodeTypes); // public catalog
  app.route("/workflows", workflows); // authed (x-owner-id)

  // Durable engine endpoint (QStash-invoked). The Upstash Hono adapter expects
  // WorkflowBindings; our app supplies them from env at runtime.
  app.post("/engine", (c) => engineRoute(c as never));

  return app;
}
