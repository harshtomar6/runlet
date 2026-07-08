// Vercel entry (Node.js runtime). Pre-bundled into api/_app.mjs by `vercel-build`.
//
// Use @hono/node-server's Vercel adapter, NOT hono/vercel: the latter returns a
// Web/Edge fetch handler `(req: Request) => Response`, but we run on the Node
// runtime (postgres.js, undici, nodemailer, node:crypto). On Node that handler
// never completes the response → requests hang pending. This adapter returns a
// proper Node `(req, res)` handler that writes and ends the response.
import { handle } from "@hono/node-server/vercel";
import { createApp } from "../http/app";

export const runtime = "nodejs";
export default handle(createApp());
