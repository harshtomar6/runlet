import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { env } from "./config/env";
import { createApp } from "./http/app";

const app = createApp();

// Local dev console (Node only): open http://localhost:<port>/ui
app.get("/ui", serveStatic({ path: "./public/index.html" }));
app.use("/ui/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`Runlet listening on http://localhost:${info.port}  ·  dev UI: /ui`);
});
