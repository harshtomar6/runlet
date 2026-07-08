import type { Context } from "hono";
import type { z } from "zod";
import { ApiError } from "../../errors";

/** Parse + validate a JSON request body against a zod schema (defaults applied). */
export async function parseBody<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, "validation_error", "Invalid request body", result.error.flatten());
  }
  return result.data;
}
