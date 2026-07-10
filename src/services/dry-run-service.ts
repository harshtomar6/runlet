import { dryRunConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import type { Edge, Node, RunEvent, TriggerConfig, WorkflowVersion } from "../domain/types";
import { LocalExecutionContext } from "../engine/local-context";
import { runWorkflow } from "../engine/interpreter";
import { MemoryEventSink } from "../engine/sink";
import type { Store } from "../ports";
import { MemoryStore } from "../storage/memory/store";
import { validateGraph, type ValidationResult } from "./validation";

export interface DryRunInput {
  trigger: TriggerConfig;
  nodes: Node[];
  edges: Edge[];
  input?: unknown; // sample trigger payload
}

export interface DryRunResult {
  ok: boolean;
  validation: ValidationResult;
  outputs: Record<string, unknown>; // per-node output (nodeId → data)
  events: RunEvent[];
  sleeps: Array<{ stepId: string; seconds: number }>;
  error?: string;
}

/**
 * Simulate a whole workflow with NO side effects: dry-run connectors (no real
 * email/HTTP/Slack/AI), isolated in-memory kv/conversations, but the caller's
 * real credentials/connections so references resolve (owner-scoped, read-only).
 * Returns every node's output + the event timeline — the "does it actually run"
 * check for a builder (human or agent) before activating.
 */
export class DryRunService {
  constructor(private readonly store: Store) {}

  async run(ownerId: string, input: DryRunInput): Promise<DryRunResult> {
    const validation = validateGraph({ trigger: input.trigger, nodes: input.nodes, edges: input.edges });
    if (!validation.ok) {
      return { ok: false, validation, outputs: {}, events: [], sleeps: [] };
    }

    const runId = `dry_${newId()}`;
    const def: WorkflowVersion = {
      id: "dry",
      workflowId: "dry",
      version: 0,
      nodes: input.nodes,
      edges: input.edges,
      createdAt: new Date(),
    };
    const sink = new MemoryEventSink();
    const exec = new LocalExecutionContext(runId);
    const scratch = new MemoryStore(); // isolate kv/conversation writes from real state

    try {
      await runWorkflow(exec, {
        runId,
        def,
        trigger: input.input ?? {},
        sink,
        rt: {
          kv: scratch.kv,
          credentials: this.store.credentials, // real, owner-scoped reads
          connections: this.store.connections,
          connectors: dryRunConnectors(), // no real side effects
          conversations: scratch.conversations,
          ownerId,
        },
      });
      return { ok: true, validation, outputs: outputsFromEvents(sink.events), events: sink.events, sleeps: exec.sleeps };
    } catch (err) {
      // Partial trace: node.executed events up to the failure + the node.failed.
      return {
        ok: false,
        validation,
        outputs: outputsFromEvents(sink.events),
        events: sink.events,
        sleeps: exec.sleeps,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function outputsFromEvents(events: RunEvent[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of events) {
    if (e.type === "node.executed" && e.nodeId) out[e.nodeId] = e.output;
  }
  return out;
}
