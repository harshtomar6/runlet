import { Hono } from "hono";
import { z } from "zod";
import { newId } from "../../domain/ids";
import { ApiError } from "../../errors";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const CreateCredentialSchema = z.object({
  type: z.string().min(1), // "resend" | "slack" | ...
  secret: z.record(z.unknown()), // e.g. { apiKey } / { webhookUrl }
});

/** Encrypted credential storage. Secrets are write-only; never returned. */
export const credentials = new Hono<AppEnv>();
credentials.use("*", auth);

credentials.post("/", async (c) => {
  const input = await parseBody(c, CreateCredentialSchema);
  const id = newId();
  await store.credentials.put({ id, ownerId: c.get("ownerId"), type: input.type, secret: input.secret });
  return ok(c, { id, type: input.type }, {}, 201);
});

credentials.get("/", async (c) => ok(c, await store.credentials.list(c.get("ownerId"))));

credentials.delete("/:id", async (c) => {
  const deleted = await store.credentials.delete(c.req.param("id"), c.get("ownerId"));
  if (!deleted) throw new ApiError(404, "not_found", "Credential not found");
  return ok(c, { deleted: true });
});
