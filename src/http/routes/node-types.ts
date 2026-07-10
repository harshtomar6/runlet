import { Hono } from "hono";
import { ApiError } from "../../errors";
import { customNodeDefinition } from "../../nodes/custom";
import { getNode, listNodes, toCatalogEntry, toCatalogGroups } from "../../nodes";
import { store } from "../../storage/factory";
import { optionalAuth } from "../middleware/auth";
import { ok } from "../lib/respond";
import type { AppEnv } from "../types";

/**
 * Public catalog: lets any UI render a node palette + config forms. When the
 * request is authenticated (optional), the caller's custom (API-created) nodes
 * are merged in, so they're discoverable like built-ins.
 */
export const nodeTypes = new Hono<AppEnv>();

async function allNodes(ownerId: string | undefined) {
  const builtins = listNodes();
  if (!ownerId) return builtins;
  const customs = (await store.nodeDefs.listByOwner(ownerId)).map(customNodeDefinition);
  return [...builtins, ...customs];
}

// Flat list by default; `?grouped=true` groups by integration/app (n8n-style).
nodeTypes.get("/", optionalAuth, async (c) => {
  const grouped = c.req.query("grouped");
  const nodes = await allNodes(c.get("ownerId"));
  if (grouped === "true" || grouped === "1") return ok(c, toCatalogGroups(nodes));
  return ok(c, nodes.map(toCatalogEntry));
});

nodeTypes.get("/:type", optionalAuth, async (c) => {
  const type = c.req.param("type");
  const def = getNode(type) ?? (await allNodes(c.get("ownerId"))).find((n) => n.type === type);
  if (!def) throw new ApiError(404, "not_found", `Unknown node type: ${type}`);
  return ok(c, toCatalogEntry(def));
});
