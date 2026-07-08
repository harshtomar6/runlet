import type { MiddlewareHandler } from "hono";
import { ApiError } from "../../errors";
import type { AppEnv } from "../types";

/**
 * Minimal tenant identification for M2. Reads the owner from the `x-owner-id`
 * header. TODO(auth): replace with API-key / JWT verification.
 */
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const ownerId = c.req.header("x-owner-id");
  if (!ownerId) {
    throw new ApiError(401, "unauthorized", "Missing x-owner-id header");
  }
  c.set("ownerId", ownerId);
  await next();
};
