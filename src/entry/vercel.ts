import { handle } from "hono/vercel";
import { createApp } from "../http/app";

/** Vercel entry. Referenced by api/index.ts. Runs on the Node runtime. */
export const runtime = "nodejs";
export default handle(createApp());
