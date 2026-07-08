import { Hono } from "hono";
import { health } from "./routes/health";

/**
 * Builds the HTTP app. Route groups for workflows, runs, node-types,
 * credentials, and triggers are added in later milestones (see DESIGN.md §12).
 */
export function createApp(): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ name: "app-automations", version: "0.1.0" }));
  app.route("/health", health);

  return app;
}
