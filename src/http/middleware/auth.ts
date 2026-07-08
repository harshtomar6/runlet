import type { MiddlewareHandler } from "hono";
import { env } from "../../config/env";
import { ApiError } from "../../errors";
import { ApiKeyService } from "../../services/api-key-service";
import { store } from "../../storage/factory";
import type { AppEnv } from "../types";

const apiKeys = new ApiKeyService(store);

/**
 * API-key authentication. Accepts `Authorization: Bearer <key>` or
 * `x-api-key: <key>`; resolves the owning id and sets it on the context.
 *
 * Dev escape hatch: if AUTH_DEV_OWNER is set, verification is skipped and that
 * owner is used. Never set AUTH_DEV_OWNER in production.
 */
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (env.AUTH_DEV_OWNER) {
    c.set("ownerId", env.AUTH_DEV_OWNER);
    return next();
  }

  const header = c.req.header("authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : c.req.header("x-api-key");
  if (!key) throw new ApiError(401, "unauthorized", "Missing API key (Authorization: Bearer <key>)");

  const result = await apiKeys.verify(key);
  if (!result) throw new ApiError(401, "invalid_api_key", "Invalid or revoked API key");

  c.set("ownerId", result.ownerId);
  await next();
};
