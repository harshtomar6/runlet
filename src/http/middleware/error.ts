import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ApiError } from "../../errors";
import { NotFoundError } from "../../ports/errors";
import type { AppEnv } from "../types";

/** Maps thrown errors to the standard error envelope. */
export const onError: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get("requestId");

  if (err instanceof ApiError) {
    return c.json(
      { data: null, error: { code: err.code, message: err.message, details: err.details ?? null }, meta: { requestId } },
      err.status as ContentfulStatusCode,
    );
  }
  if (err instanceof NotFoundError) {
    return c.json(
      { data: null, error: { code: "not_found", message: err.message, details: null }, meta: { requestId } },
      404,
    );
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  return c.json(
    { data: null, error: { code: "internal_error", message: "Internal server error", details: null }, meta: { requestId } },
    500,
  );
};
