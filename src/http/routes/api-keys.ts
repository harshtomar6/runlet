import { Hono } from "hono";
import { z } from "zod";
import { ApiKeyService } from "../../services/api-key-service";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const service = new ApiKeyService(store);

const CreateKeySchema = z.object({ name: z.string().min(1) });

/**
 * Manage the caller's own API keys. Authed by an existing key (bootstrap the
 * first one with `pnpm create-api-key`).
 */
export const apiKeys = new Hono<AppEnv>();
apiKeys.use("*", auth);

apiKeys.post("/", async (c) => {
  const { name } = await parseBody(c, CreateKeySchema);
  const issued = await service.issue(c.get("ownerId"), name);
  // `key` is returned exactly once.
  return ok(c, issued, {}, 201);
});

apiKeys.get("/", async (c) => ok(c, await service.list(c.get("ownerId"))));

apiKeys.delete("/:id", async (c) => {
  await service.revoke(c.get("ownerId"), c.req.param("id"));
  return ok(c, { revoked: true });
});
