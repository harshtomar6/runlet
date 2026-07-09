import { Hono } from "hono";
import { ApiError } from "../../errors";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

/** OAuth connections owned by the caller. Tokens are never returned. */
export const connections = new Hono<AppEnv>();
connections.use("*", auth);

connections.get("/", async (c) => ok(c, await store.connections.listByOwner(c.get("ownerId"))));

connections.delete("/:id", async (c) => {
  const removed = await store.connections.delete(c.req.param("id"), c.get("ownerId"));
  if (!removed) throw new ApiError(404, "not_found", "Connection not found");
  // Best-effort provider-side revocation is a follow-up; local record is removed now.
  return ok(c, { deleted: true });
});
