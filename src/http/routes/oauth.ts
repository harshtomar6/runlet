import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../config/env";
import { OAuthService } from "../../services/oauth-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new OAuthService(store, store.kv);

const StartSchema = z.object({ returnTo: z.string().url().optional() });

/**
 * OAuth account-connection flow.
 *   POST /oauth/:provider/start   (authed)  -> { authorizeUrl }  — redirect the browser there
 *   GET  /oauth/:provider/callback (public) -> stores the connection, redirects back
 * The callback is unauthenticated (a browser redirect); trust rests on the
 * single-use, owner-bound `state`.
 */
export const oauth = new Hono<AppEnv>();

oauth.post("/:provider/start", auth, async (c) => {
  const provider = c.req.param("provider");
  const { returnTo } = await parseBody(c, StartSchema);
  const res = await service.start(c.get("ownerId"), provider, { returnTo });
  return ok(c, res);
});

oauth.get("/:provider/callback", async (c) => {
  const provider = c.req.param("provider");
  const err = c.req.query("error");
  if (err) {
    // User denied / provider error — bounce back with the reason if we can.
    if (env.OAUTH_SUCCESS_REDIRECT) {
      return c.redirect(`${env.OAUTH_SUCCESS_REDIRECT}?oauth_error=${encodeURIComponent(err)}`);
    }
    return ok(c, { connected: false, error: err }, {}, 400);
  }
  const { connection, returnTo } = await service.callback(provider, {
    code: c.req.query("code"),
    state: c.req.query("state"),
  });
  const dest = returnTo ?? env.OAUTH_SUCCESS_REDIRECT;
  if (dest) return c.redirect(dest);
  return ok(c, { connected: true, connection });
});
