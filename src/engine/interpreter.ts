import { newId } from "../domain/ids";
import type { Edge, RunEvent, WorkflowVersion } from "../domain/types";
import { getNode } from "../nodes";
import type { NodeRuntime } from "../nodes/define";
import type { ExecutionContext } from "./context";
import { parseDuration } from "./duration";
import { resolveInputs, resolveValue } from "./expr";
import type { EventSink } from "./sink";

export interface RunParams {
  runId: string;
  def: WorkflowVersion; // pinned nodes/edges
  trigger: unknown;
  sink: EventSink;
  rt: Omit<NodeRuntime, "runId" | "workflowRunId">;
}

export interface RunOutcome {
  outputs: Record<string, unknown>;
}

/**
 * Generic durable interpreter. Walks the graph from the trigger node, running
 * each node as a durable step. Linear + single-branch (`control.if`) for M3;
 * loops/joins arrive in M7. See DESIGN.md §6.
 */
export async function runWorkflow(exec: ExecutionContext, p: RunParams): Promise<RunOutcome> {
  const { def, trigger, sink } = p;
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  const outputs: Record<string, unknown> = {};

  const rt: NodeRuntime = { ...p.rt, runId: p.runId, workflowRunId: exec.workflowRunId };

  // Wrapped in a durable step so it isn't re-emitted on every QStash replay
  // and so newId()/new Date() run once (checkpointed) — see DESIGN §6.1/§6.2.
  await exec.run("run-started", () => sink.append(evt(p.runId, "run.started", { input: trigger })));

  const triggerNode = def.nodes.find((n) => getNode(n.type)?.kind === "trigger");
  const frontier: string[] = [];
  if (triggerNode) {
    outputs[triggerNode.id] = trigger;
    frontier.push(...successors(def.edges, triggerNode.id, "out"));
  } else {
    // No trigger node: start from every node without an inbound edge.
    const hasInbound = new Set(def.edges.map((e) => e.to.nodeId));
    frontier.push(...def.nodes.filter((n) => !hasInbound.has(n.id)).map((n) => n.id));
  }

  const scope = () => ({ trigger, ...outputs });
  const visited = new Set<string>();

  while (frontier.length > 0) {
    const id = frontier.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);

    const node = nodesById.get(id);
    if (!node) continue;
    const def2 = getNode(node.type);
    if (!def2) throw new Error(`Unknown node type at runtime: ${node.type}`);

    if (def2.kind === "wait") {
      const seconds = parseDuration(String(resolveValue(node.params.duration, scope())));
      await exec.sleep(`sleep:${id}`, seconds);
      frontier.push(...successors(def.edges, id, "out"));
      continue;
    }

    if (!def2.execute) {
      throw new Error(`Node type "${node.type}" has no runtime implementation`);
    }

    const inputs = resolveInputs(node.params, scope());
    const schema = def2.inputSchema;
    const executeFn = def2.execute;
    const outcome = await exec.run(`node:${id}`, async () => {
      await sink.append(evt(p.runId, "node.started", { nodeId: id, input: inputs }));
      try {
        // Validate resolved inputs before running (DESIGN §8) — fail fast on a
        // missing/wrong-typed value instead of silently coercing (e.g. "undefined").
        const parsed = schema.safeParse(inputs);
        if (!parsed.success) {
          throw new Error(`Invalid inputs for node "${id}" (${node.type}): ${parsed.error.message}`);
        }
        const result = await executeFn({
          inputs: parsed.data as Record<string, unknown>,
          params: node.params,
          rt,
        });
        await sink.append(evt(p.runId, "node.executed", { nodeId: id, output: result.data ?? null }));
        return result;
      } catch (err) {
        await sink.append(evt(p.runId, "node.failed", { nodeId: id, error: serializeError(err) }));
        throw err;
      }
    });

    outputs[id] = outcome.data ?? null;
    const port = outcome.port ?? def2.outputs[0] ?? "out";
    frontier.push(...successors(def.edges, id, port));
  }

  await exec.run("run-succeeded", () => sink.append(evt(p.runId, "run.succeeded", {})));
  return { outputs };
}

function successors(edges: Edge[], nodeId: string, port: string): string[] {
  return edges.filter((e) => e.from.nodeId === nodeId && e.from.port === port).map((e) => e.to.nodeId);
}

function evt(
  runId: string,
  type: RunEvent["type"],
  extra: { nodeId?: string; input?: unknown; output?: unknown; error?: unknown },
): RunEvent {
  return { id: newId(), runId, type, ts: new Date(), ...extra };
}

function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}
