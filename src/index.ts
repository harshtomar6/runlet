import { serve } from "@hono/node-server";
import { env } from "./config/env";
import { createApp } from "./http/app";

const app = createApp();

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`app-automations listening on http://localhost:${info.port}`);
});
