import { z } from "zod";
import type { Edge, Node, TriggerConfig } from "../domain/types";
import { getNode } from "../nodes";

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
}

export interface GraphInput {
  trigger: TriggerConfig;
  nodes: Node[];
  edges: Edge[];
}

/**
 * Structural validation of a workflow graph against the node registry.
 * Deliberately does not type-check expression values (a param may hold a
 * `{{ ... }}` expression instead of a literal); it checks shape and wiring.
 */
export function validateGraph(input: GraphInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const { nodes, edges } = input;

  // Duplicate node ids
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) {
      errors.push({ code: "duplicate_node_id", message: `Duplicate node id "${n.id}"`, nodeId: n.id });
    }
    seen.add(n.id);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Trigger nodes: exactly one
  const triggerNodes = nodes.filter((n) => getNode(n.type)?.kind === "trigger");
  if (triggerNodes.length === 0) {
    errors.push({ code: "no_trigger", message: "Workflow has no trigger node" });
  } else if (triggerNodes.length > 1) {
    errors.push({
      code: "multiple_triggers",
      message: `Workflow has ${triggerNodes.length} trigger nodes; exactly one is allowed`,
    });
  }

  // Unknown node types + required params
  for (const n of nodes) {
    const def = getNode(n.type);
    if (!def) {
      errors.push({ code: "unknown_node_type", message: `Unknown node type "${n.type}"`, nodeId: n.id });
      continue;
    }
    for (const key of requiredKeys(def.inputSchema)) {
      if (!(key in (n.params ?? {}))) {
        errors.push({
          code: "missing_param",
          message: `Node "${n.id}" (${n.type}) is missing required param "${key}"`,
          nodeId: n.id,
        });
      }
    }
  }

  // Edge endpoints + output ports
  for (const e of edges) {
    const from = byId.get(e.from.nodeId);
    const to = byId.get(e.to.nodeId);
    if (!from) {
      errors.push({ code: "dangling_edge", message: `Edge from unknown node "${e.from.nodeId}"`, nodeId: e.from.nodeId });
    } else {
      const def = getNode(from.type);
      if (def && !def.outputs.includes(e.from.port)) {
        errors.push({
          code: "invalid_output_port",
          message: `Node "${from.id}" (${from.type}) has no output port "${e.from.port}"`,
          nodeId: from.id,
        });
      }
    }
    if (!to) {
      errors.push({ code: "dangling_edge", message: `Edge to unknown node "${e.to.nodeId}"`, nodeId: e.to.nodeId });
    }
  }

  // Orphans: non-trigger nodes with no inbound edge are unreachable
  const hasInbound = new Set(edges.map((e) => e.to.nodeId));
  for (const n of nodes) {
    if (getNode(n.type)?.kind === "trigger") continue;
    if (!hasInbound.has(n.id)) {
      errors.push({ code: "orphan_node", message: `Node "${n.id}" is not reachable (no inbound edge)`, nodeId: n.id });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** Keys of a ZodObject that are neither optional, nullable, nor defaulted. */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  if (!(schema instanceof z.ZodObject)) return [];
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  return Object.entries(shape)
    .filter(([, v]) => !isOptionalLike(v))
    .map(([k]) => k);
}

function isOptionalLike(s: z.ZodTypeAny): boolean {
  return s instanceof z.ZodOptional || s instanceof z.ZodDefault || s instanceof z.ZodNullable;
}
