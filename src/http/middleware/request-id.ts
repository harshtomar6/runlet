import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("requestId", randomUUID());
  await next();
};
