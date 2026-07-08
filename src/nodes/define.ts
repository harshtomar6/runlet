import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type NodeKind = "trigger" | "action" | "wait" | "control";

/**
 * A node type: its UI-facing metadata + input schema. The runtime `execute`
 * function is attached in M3 when the interpreter exists; M2 only needs the
 * catalog (schemas + ports) so UIs can render a palette and config forms.
 */
export interface NodeDefinition {
  type: string; // registry key, e.g. "email.send"
  kind: NodeKind;
  category: string;
  label: string;
  description?: string;
  inputSchema: z.ZodTypeAny;
  outputs: string[]; // edge output ports
  credentials?: string[]; // required credential types
}

export interface CatalogEntry {
  type: string;
  kind: NodeKind;
  category: string;
  label: string;
  description: string | null;
  outputs: string[];
  credentials: string[];
  inputSchema: ReturnType<typeof zodToJsonSchema>;
}

/** Identity helper for authoring node definitions with inference/checking. */
export function defineNode(def: NodeDefinition): NodeDefinition {
  return def;
}

/** Serialise a node definition for the catalog API. */
export function toCatalogEntry(def: NodeDefinition): CatalogEntry {
  return {
    type: def.type,
    kind: def.kind,
    category: def.category,
    label: def.label,
    description: def.description ?? null,
    outputs: def.outputs,
    credentials: def.credentials ?? [],
    inputSchema: zodToJsonSchema(def.inputSchema, { name: def.type }),
  };
}
