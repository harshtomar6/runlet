import { Hono } from "hono";
import { z } from "zod";
import { newId } from "../../domain/ids";
import type { CustomNodeDef } from "../../domain/types";
import { expressionSyntaxErrors } from "../../engine/expr";
import { ApiError } from "../../errors";
import { getNode } from "../../nodes";
import { store } from "../../storage/factory";
import { auth } from "../middleware/auth";
import { parseBody } from "../lib/parse";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

const CreateNodeDefSchema = z.object({
  // Namespaced under "custom." so it can't shadow a built-in node type.
  type: z.string().regex(/^custom\.[A-Za-z0-9][A-Za-z0-9._-]*$/, 'type must match /^custom\\.[A-Za-z0-9._-]+$/'),
  label: z.string().min(1),
  app: z.string().min(1).default("custom"),
  category: z.string().min(1).default("Custom"),
  description: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(["string", "number", "boolean", "json"]).default("string"),
        required: z.boolean().default(false),
        description: z.string().optional(),
      }),
    )
    .default([]),
  request: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  outputs: z.array(z.string().min(1)).default(["success", "error"]),
});

/** Custom (API-created) node definitions — declarative HTTP nodes, owner-scoped. */
export const nodeDefs = new Hono<AppEnv>();
nodeDefs.use("*", auth);

nodeDefs.post("/", async (c) => {
  const input = await parseBody(c, CreateNodeDefSchema);
  const ownerId = c.get("ownerId");

  if (getNode(input.type)) {
    throw new ApiError(409, "type_reserved", `"${input.type}" collides with a built-in node type`);
  }
  const existing = (await store.nodeDefs.listByOwner(ownerId)).find((d) => d.type === input.type);
  if (existing) throw new ApiError(409, "type_exists", `You already have a node type "${input.type}"`);

  // Reject a malformed {{ }} in the request template up front (can't fix it at run time).
  const exprErrors = expressionSyntaxErrors(input.request);
  if (exprErrors.length > 0) {
    throw new ApiError(400, "invalid_expression", "Request template has invalid expressions", exprErrors);
  }

  const now = new Date();
  const def: CustomNodeDef = {
    id: newId(),
    ownerId,
    type: input.type,
    label: input.label,
    app: input.app,
    category: input.category,
    description: input.description,
    fields: input.fields,
    request: input.request,
    outputs: input.outputs,
    createdAt: now,
    updatedAt: now,
  };
  await store.nodeDefs.create(def);
  return ok(c, def, {}, 201);
});

nodeDefs.get("/", async (c) => ok(c, await store.nodeDefs.listByOwner(c.get("ownerId"))));

nodeDefs.get("/:id", async (c) => {
  const def = await store.nodeDefs.get(c.req.param("id"), c.get("ownerId"));
  if (!def) throw new ApiError(404, "not_found", "Custom node not found");
  return ok(c, def);
});

nodeDefs.delete("/:id", async (c) => {
  const removed = await store.nodeDefs.delete(c.req.param("id"), c.get("ownerId"));
  if (!removed) throw new ApiError(404, "not_found", "Custom node not found");
  return ok(c, { deleted: true });
});
