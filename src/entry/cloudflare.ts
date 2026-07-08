import { createApp } from "../http/app";

/**
 * Cloudflare Workers entry. Requires `nodejs_compat` and DB_DRIVER=neon
 * (postgres.js TCP sockets are unavailable on Workers). See DEPLOY.md.
 */
const app = createApp();

export default {
  fetch: app.fetch,
};
