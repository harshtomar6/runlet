import { Hono } from "hono";
import { ApiError } from "../../errors";
import { getNode, listNodes, toCatalogEntry } from "../../nodes";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

/** Public catalog: lets any UI render a node palette + config forms. */
export const nodeTypes = new Hono<AppEnv>();

nodeTypes.get("/", (c) => ok(c, listNodes().map(toCatalogEntry)));

nodeTypes.get("/:type", (c) => {
  const type = c.req.param("type");
  const def = getNode(type);
  if (!def) throw new ApiError(404, "not_found", `Unknown node type: ${type}`);
  return ok(c, toCatalogEntry(def));
});
