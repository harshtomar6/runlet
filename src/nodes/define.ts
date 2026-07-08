import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CredentialStore, KVState } from "../ports";
import type { Connectors } from "../connectors";

export type NodeKind = "trigger" | "action" | "wait" | "control";

/** Runtime services handed to a node's execute function. */
export interface NodeRuntime {
  kv: KVState;
  credentials: CredentialStore;
  connectors: Connectors;
  runId: string;
  workflowRunId: string;
  /** Durable step id for this execution (iteration-scoped inside loops).
   *  Use it in idempotency keys so retries of the SAME step dedup, while
   *  distinct loop iterations do not. */
  stepId: string;
}

export interface NodeExecArgs {
  inputs: Record<string, unknown>; // params with expressions resolved
  params: Record<string, unknown>; // raw params
  rt: NodeRuntime;
}

/** What a node returns: data passed downstream + optional chosen output port. */
export interface NodeOutcome {
  data?: unknown;
  port?: string;
}

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
  /** Runtime behavior. Absent for pass-through trigger nodes and unimplemented types. */
  execute?: (args: NodeExecArgs) => Promise<NodeOutcome>;
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
