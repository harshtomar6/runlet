import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types";

/** Standard success envelope: { data, error, meta }. */
export function ok(
  c: Context<AppEnv>,
  data: unknown,
  meta: Record<string, unknown> = {},
  status: ContentfulStatusCode = 200,
) {
  return c.json({ data, error: null, meta: { requestId: c.get("requestId"), ...meta } }, status);
}
