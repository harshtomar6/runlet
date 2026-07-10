import { Hono } from "hono";
import { z } from "zod";
import { env } from "../../config/env";
import { ApiError } from "../../errors";
import { ApiKeyService } from "../../services/api-key-service";
import { store } from "../../storage/factory";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const apiKeys = new ApiKeyService(store);

const CreateTenantSchema = z.object({
  ownerId: z.string().min(1), // your stable tenant id — becomes the Runlet owner
  name: z.string().min(1).default("bff"),
});

/**
 * Privileged provisioning endpoints for a backend to onboard tenants. Guarded by
 * a shared ADMIN_SECRET (NOT per-owner API-key auth), fail-closed like the
 * internal trigger endpoints. Mints the FIRST API key for a brand-new owner —
 * the one operation `/api-keys` can't do (it only mints for the caller's owner).
 */
export const admin = new Hono<AppEnv>();

admin.use("*", async (c, next) => {
  if (!env.ADMIN_SECRET) throw new ApiError(503, "admin_secret_unset", "ADMIN_SECRET is not configured");
  if (c.req.header("x-admin-secret") !== env.ADMIN_SECRET) {
    throw new ApiError(401, "unauthorized", "Invalid admin secret");
  }
  await next();
});

admin.post("/tenants", async (c) => {
  const { ownerId, name } = await parseBody(c, CreateTenantSchema);
  // `key` is returned exactly once — the caller must store it (encrypted).
  const issued = await apiKeys.issue(ownerId, name);
  return ok(c, { ownerId, ...issued }, {}, 201);
});
