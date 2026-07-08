import type { Context } from "hono";
import { Hono } from "hono";
import { env } from "../../config/env";
import { LLMS_TXT } from "../llms-content";

/**
 * Public `/llms.txt` — serves the LLM-oriented build guide (WORKFLOW_API.md)
 * as plain text, following the llmstxt.org convention. Point any AI at this URL
 * and it can build workflows against this API from natural language.
 *
 * The guide itself is host-agnostic, so we prepend the concrete base URL for
 * THIS deployment (resolved per request) — otherwise a consuming LLM wouldn't
 * know where to send requests.
 */
export const llms = new Hono();

/** PUBLIC_BASE_URL if set, else derived from the request's forwarded host/proto. */
function resolveBaseUrl(c: Context): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  let parsed: URL | undefined;
  try {
    parsed = new URL(c.req.url);
  } catch {
    // c.req.url malformed — fall back to headers only.
  }
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || parsed?.protocol.replace(":", "") || "https";
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || parsed?.host || "";
  return host ? `${proto}://${host}` : "";
}

llms.get("/", (c) => {
  const base = resolveBaseUrl(c);
  const preamble = base
    ? `> **Base URL for this deployment:** ${base}\n` +
      `> Every endpoint path below is relative to it — e.g. \`POST ${base}/workflows\`, ` +
      `\`GET ${base}/node-types\`. Authenticate with \`Authorization: Bearer <API key>\` (see §2).\n\n`
    : "";
  c.header("cache-control", "public, max-age=3600");
  return c.text(preamble + LLMS_TXT);
});
