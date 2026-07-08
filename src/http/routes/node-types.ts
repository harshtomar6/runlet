import { Hono } from "hono";
import { ApiError } from "../../errors";
import { getNode, listNodes, toCatalogEntry, toCatalogGroups } from "../../nodes";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

/** Public catalog: lets any UI render a node palette + config forms. */
export const nodeTypes = new Hono<AppEnv>();

// Flat list by default; `?grouped=true` groups by integration/app (n8n-style).
nodeTypes.get("/", (c) => {
  const grouped = c.req.query("grouped");
  if (grouped === "true" || grouped === "1") {
    return ok(c, toCatalogGroups(listNodes()));
  }
  return ok(c, listNodes().map(toCatalogEntry));
});

nodeTypes.get("/:type", (c) => {
  const type = c.req.param("type");
  const def = getNode(type);
  if (!def) throw new ApiError(404, "not_found", `Unknown node type: ${type}`);
  return ok(c, toCatalogEntry(def));
});
