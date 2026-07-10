import { z } from "zod";
import type { CustomNodeDef, CustomNodeField } from "../domain/types";
import { defineNode, type NodeDefinition } from "./define";

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
  // Every custom node may reference auth for its HTTP action (used by the executor).
  shape.credentialId = z.string().optional();
  shape.connectionId = z.string().optional();
  return z.object(shape);
}

/**
 * Turn a stored custom node definition into a runtime NodeDefinition (catalog +
 * validation). `execute` is attached in Slice 2 (the HTTP-template executor);
 * here it's undefined, so it's discoverable and validatable but not yet runnable.
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
  });
}
