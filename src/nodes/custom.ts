import { z } from "zod";
import type { CustomHttpRequest, CustomNodeDef, CustomNodeField } from "../domain/types";
import { resolveSecretRefs, resolveValue } from "../engine/expr";
import type { Store } from "../ports";
import { defineNode, type NodeDefinition } from "./define";
import { getNode } from "./registry";

/** Resolves a node type to its definition (custom-first, then built-ins). */
export type NodeResolver = (type: string) => NodeDefinition | undefined;

/** Build a zod schema for a custom node's declared fields (+ optional auth refs). */
export function fieldsToSchema(fields: CustomNodeField[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let base: z.ZodTypeAny;
    switch (f.type) {
      case "number":
        base = z.number();
        break;
      case "boolean":
        base = z.boolean();
        break;
      case "json":
        base = z.unknown();
        break;
      default:
        base = z.string();
    }
    shape[f.name] = f.required ? base : base.optional();
  }
  // Every custom node may reference auth for its HTTP action.
  shape.credentialId = z.string().optional();
  shape.connectionId = z.string().optional();
  return z.object(shape);
}

/**
 * Turn a stored custom node definition into a runtime NodeDefinition. `execute`
 * runs the stored HTTP request template: field values fill `{{ field }}`, and a
 * referenced credential/connection fills `{{ $secret.* }}`, then the SSRF-safe
 * HTTP connector performs the request. Never runs arbitrary code.
 */
export function customNodeDefinition(def: CustomNodeDef): NodeDefinition {
  return defineNode({
    type: def.type,
    app: def.app,
    kind: "action",
    category: def.category,
    label: def.label,
    description: def.description,
    inputSchema: fieldsToSchema(def.fields),
    outputs: def.outputs.length > 0 ? def.outputs : ["success", "error"],
    execute: async ({ inputs, params, rt }) => {
      // Resolve auth from a connection (Bearer) or a credential ({ $secret }).
      const injected: Record<string, string> = {};
      let secret: Record<string, unknown> = {};
      if (params.connectionId) {
        if (!rt.connections) throw new Error(`${def.type}: connections are unavailable in this runtime`);
        const conn = await rt.connections.get(String(params.connectionId), rt.ownerId);
        injected.authorization = `Bearer ${conn.accessToken}`;
        secret = { accessToken: conn.accessToken, accountId: conn.accountId, ...conn.raw };
      } else if (params.credentialId) {
        const creds = await rt.credentials.get(String(params.credentialId), rt.ownerId);
        secret = creds.secret;
      }

      // Fill the template: {{ field }} from the node's inputs, then {{ $secret.* }}.
      const filled = (await resolveSecretRefs(await resolveValue(def.request, { ...inputs }), secret)) as CustomHttpRequest;
      const headers = { ...(filled.headers ?? {}), ...injected };

      const res = await rt.connectors.http.request({
        method: String(filled.method ?? "GET"),
        url: String(filled.url),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: filled.body,
      });
      return { data: res, port: "success" };
    },
  });
}

/**
 * A resolver that sees the owner's custom nodes first, then the built-in
 * registry. Built once per validate/run and passed into validateGraph / runWorkflow.
 */
export async function buildNodeResolver(store: Store, ownerId: string): Promise<NodeResolver> {
  const customs = await store.nodeDefs.listByOwner(ownerId);
  const map = new Map(customs.map((d) => [d.type, customNodeDefinition(d)]));
  return (type: string) => map.get(type) ?? getNode(type);
}
