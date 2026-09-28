import { newId } from "../domain/ids";
import type { Edge, Node, RunEvent, WorkflowVersion } from "../domain/types";
import { getNode } from "../nodes";
import type { NodeResolver } from "../nodes/custom";
import type { NodeDefinition, NodeOutcome, NodeRuntime } from "../nodes/define";
import type { ExecutionContext } from "./context";
import { parseDuration } from "./duration";
import { resolveInputs, resolveValue } from "./expr";
import type { EventSink } from "./sink";

export interface RunParams {
  runId: string;
  def: WorkflowVersion; // pinned nodes/edges
  trigger: unknown;
  sink: EventSink;
  rt: Omit<NodeRuntime, "runId" | "workflowRunId" | "stepId">;
  /** Resolves node types (custom-first, then built-ins). Defaults to built-ins only. */
  resolveNode?: NodeResolver;
}

export interface RunOutcome {
  outputs: Record<string, unknown>;
}

const MAX_LOOP = 10_000;

/**
 * Generic durable interpreter. Walks the graph from the trigger node, running
 * each node as a durable step. Supports linear flows, `control.if` branching,
 * and `control.loop` iteration. Convergent edges run the target once
 * (first-arrival); explicit join/merge semantics are a future addition.
 * See DESIGN.md §6.
 */
export async function runWorkflow(exec: ExecutionContext, p: RunParams): Promise<RunOutcome> {
  const { def, trigger, sink } = p;
  const resolveNode = p.resolveNode ?? getNode;
  const nodesById = new Map(def.nodes.map((n) => [n.id, n]));
  const outputs: Record<string, unknown> = {};
  // `locals` carries per-iteration bindings (e.g. loop index) into resolution.
  const scope = (locals: Record<string, unknown> = {}): Record<string, unknown> => ({
    trigger,
    ...outputs,
    ...locals,
  });

  // Wrapped in a durable step so it isn't re-emitted on every QStash replay and
  // so newId()/new Date() run once (checkpointed) — see DESIGN §6.1/§6.2.
  await exec.run("run-started", () => sink.append(evt(p.runId, "run.started", { input: trigger })));

  const triggerNode = def.nodes.find((n) => resolveNode(n.type)?.kind === "trigger");
  let roots: string[];
  if (triggerNode) {
    outputs[triggerNode.id] = trigger;
    roots = successors(def.edges, triggerNode.id, "out");
  } else {
    const hasInbound = new Set(def.edges.map((e) => e.to.nodeId));
    roots = def.nodes.filter((n) => !hasInbound.has(n.id)).map((n) => n.id);
  }

  await walk(roots, "");
  await exec.run("run-succeeded", () => sink.append(evt(p.runId, "run.succeeded", {})));
  return { outputs };

  async function walk(
    startIds: string[],
    prefix: string,
    locals: Record<string, unknown> = {},
  ): Promise<void> {
    const frontier = [...startIds];
    const visited = new Set<string>();

    while (frontier.length > 0) {
      const id = frontier.shift();
      if (!id || visited.has(id)) continue;
      visited.add(id);

      const node = nodesById.get(id);
      if (!node) continue;
      const def2 = resolveNode(node.type);
      if (!def2) throw new Error(`Unknown node type at runtime: ${node.type}`);

      if (def2.kind === "wait") {
        let seconds: number;
        try {
          seconds = parseDuration(String(await resolveValue(node.params.duration, scope(locals))));
        } catch (err) {
          await exec.run(`${prefix}node:${id}:failed`, () =>
            sink.append(evt(p.runId, "node.failed", { nodeId: id, error: serializeError(err) })),
          );
          throw err;
        }
        await exec.sleep(`${prefix}sleep:${id}`, seconds);
        frontier.push(...successors(def.edges, id, "out"));
        continue;
      }

      if (node.type === "control.loop") {
        let times: number;
        try {
          times = Math.min(Number(await resolveValue(node.params.times, scope(locals))) || 0, MAX_LOOP);
        } catch (err) {
          await exec.run(`${prefix}node:${id}:failed`, () =>
            sink.append(evt(p.runId, "node.failed", { nodeId: id, error: serializeError(err) })),
          );
          throw err;
        }
        const body = successors(def.edges, id, "each");
        for (let i = 0; i < times; i++) {
          // Bind the iteration index so body nodes can resolve distinct inputs
          // (e.g. `{{ loop.index }}`) instead of repeating identical values.
          await walk(body, `${prefix}${id}:${i}:`, { ...locals, loop: { index: i } });
        }
        frontier.push(...successors(def.edges, id, "done"));
        continue;
      }

      if (!def2.execute) throw new Error(`Node type "${node.type}" has no runtime implementation`);

      const schema = def2.inputSchema;
      const executeFn = def2.execute;
      const baseStepId = `${prefix}node:${id}`;
      const sc = scope(locals);
      const outcome = def2.durable
        ? await runDurableNode(baseStepId, sc, executeFn, schema, id, node)
        : await runStepNode(baseStepId, sc, executeFn, schema, id, node);

      outputs[id] = outcome.data ?? null;
      const port = outcome.port ?? def2.outputs[0] ?? "out";
      frontier.push(...successors(def.edges, id, port));
    }
  }

  // Normal node: the whole execution is ONE durable step.
  async function runStepNode(
    baseStepId: string,
    sc: Record<string, unknown>,
    executeFn: NonNullable<NodeDefinition["execute"]>,
    schema: NodeDefinition["inputSchema"],
    id: string,
    node: Node,
  ): Promise<NodeOutcome> {
    const rt: NodeRuntime = { ...p.rt, runId: p.runId, workflowRunId: exec.workflowRunId, stepId: baseStepId };
    return exec.run(baseStepId, async () => {
      await sink.append(evt(p.runId, "node.started", { nodeId: id, input: node.params }));
      try {
        // Resolve expressions INSIDE the step so a resolution error is recorded
        // as node.failed (not thrown silently outside any step).
        const inputs = await resolveInputs(node.params, sc);
        const parsed = schema.safeParse(inputs);
        if (!parsed.success) throw new Error(`Invalid inputs for node "${id}" (${node.type}): ${parsed.error.message}`);
        const result = plainOutcome(
          await executeFn({ inputs: parsed.data as Record<string, unknown>, params: node.params, rt }),
        );
        await sink.append(evt(p.runId, "node.executed", { nodeId: id, output: result.data ?? null }));
        return result;
      } catch (err) {
        await sink.append(evt(p.runId, "node.failed", { nodeId: id, error: serializeError(err) }));
        throw err;
      }
    });
  }

  // Durable node: NOT wrapped in a single step; it owns its sub-steps via
  // rt.step / rt.waitForEvent (each checkpointed at top level). Events are each
  // written in their own step so they don't duplicate on replay.
  async function runDurableNode(
    baseStepId: string,
    sc: Record<string, unknown>,
    executeFn: NonNullable<NodeDefinition["execute"]>,
    schema: NodeDefinition["inputSchema"],
    id: string,
    node: Node,
  ): Promise<NodeOutcome> {
    const rt: NodeRuntime = {
      ...p.rt,
      runId: p.runId,
      workflowRunId: exec.workflowRunId,
      stepId: baseStepId,
      step: (subId, fn) => exec.run(`${baseStepId}:${subId}`, fn),
      // eventId (deterministic + unique per wait) is the step name, so a node
      // that waits multiple times (e.g. agent per-tool approval) doesn't collide.
      waitForEvent: (eventId, timeoutSec) => exec.waitForEvent(`wait:${eventId}`, eventId, timeoutSec),
    };
    await exec.run(`${baseStepId}:started`, () =>
      sink.append(evt(p.runId, "node.started", { nodeId: id, input: node.params })),
    );
    try {
      const inputs = await resolveInputs(node.params, sc);
      const parsed = schema.safeParse(inputs);
      if (!parsed.success) throw new Error(`Invalid inputs for node "${id}" (${node.type}): ${parsed.error.message}`);
      const result = plainOutcome(
        await executeFn({ inputs: parsed.data as Record<string, unknown>, params: node.params, rt }),
      );
      await exec.run(`${baseStepId}:executed`, () =>
        sink.append(evt(p.runId, "node.executed", { nodeId: id, output: result.data ?? null })),
      );
      return result;
    } catch (err) {
      await exec.run(`${baseStepId}:failed`, () =>
        sink.append(evt(p.runId, "node.failed", { nodeId: id, error: serializeError(err) })),
      );
      throw err;
    }
  }
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

/**
 * A node's output as plain JSON. JSONata builds objects with a null prototype,
 * which the Postgres event log (drizzle) rejects ("Cannot read properties of null
 * (reading 'constructor')"); durable steps JSON-serialize outputs anyway, so this
 * also makes local, dry-run and durable runs see identical data.
 */
function plainOutcome(outcome: NodeOutcome): NodeOutcome {
  if (outcome.data === undefined) return outcome;
  return { ...outcome, data: JSON.parse(JSON.stringify(outcome.data)) as unknown };
}

function serializeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: "Error", message: String(err) };
}
