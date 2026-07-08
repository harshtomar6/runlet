import type { Connectors } from "../connectors";
import { dryRunConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import { resolveInputs } from "../engine/expr";
import type { Scope } from "../engine/expr";
import { ApiError } from "../errors";
import { getNode } from "../nodes";
import type { NodeOutcome } from "../nodes/define";
import type { Store } from "../ports";

export interface TestNodeInput {
  nodeId: string;
  sampleInput?: unknown;
  versionId?: string;
  /** Default true: use dry-run connectors so testing a node has no real side effects. */
  dryRun?: boolean;
}

/** Runs a single node in isolation with sample input — n8n's "test step". */
export class NodeTestService {
  constructor(
    private readonly store: Store,
    private readonly realConnectors: Connectors,
  ) {}

  async testNode(ownerId: string, workflowId: string, input: TestNodeInput): Promise<NodeOutcome> {
    const wf = await this.store.workflows.getWorkflow(workflowId);
    if (wf.ownerId !== ownerId) throw new ApiError(404, "not_found", "Workflow not found");

    const version = input.versionId
      ? await this.store.workflows.getVersion(workflowId, input.versionId)
      : (await this.store.workflows.listVersions(workflowId))[0];
    if (!version) throw new ApiError(404, "not_found", "No version to test against");

    const node = version.nodes.find((n) => n.id === input.nodeId);
    if (!node) throw new ApiError(404, "not_found", `Node not found: ${input.nodeId}`);

    const def = getNode(node.type);
    if (!def) throw new ApiError(400, "unknown_node_type", `Unknown node type: ${node.type}`);
    if (def.kind === "wait") return { data: { note: "wait nodes have no output to test" } };
    if (!def.execute) throw new ApiError(400, "no_runtime", `Node "${node.type}" has no runtime`);

    const inputs = await resolveInputs(node.params, buildScope(input.sampleInput));

    // Validate resolved inputs so a missing/undefined value returns a clear error
    // rather than silently coercing to "undefined" inside execute.
    const parsed = def.inputSchema.safeParse(inputs);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_inputs", "Resolved inputs failed validation", parsed.error.flatten());
    }

    // Dry-run by default: no real emails/HTTP/Slack from a "test". Real connectors
    // only on explicit opt-in. A fresh workflowRunId isolates the KV namespace
    // (idempotency keys) from real runs and from other tenants' tests.
    const dryRun = input.dryRun ?? true;
    return def.execute({
      inputs: parsed.data as Record<string, unknown>,
      params: node.params,
      rt: {
        kv: this.store.kv,
        credentials: this.store.credentials,
        connectors: dryRun ? dryRunConnectors() : this.realConnectors,
        runId: `test_${newId()}`,
        workflowRunId: `test_${newId()}`,
      },
    });
  }
}

function buildScope(sampleInput: unknown): Scope {
  if (sampleInput && typeof sampleInput === "object") {
    return { trigger: sampleInput, ...(sampleInput as Record<string, unknown>) };
  }
  return { trigger: sampleInput };
}
