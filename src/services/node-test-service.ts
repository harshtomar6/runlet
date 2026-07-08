import type { Connectors } from "../connectors";
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
}

/** Runs a single node in isolation with sample input — n8n's "test step". */
export class NodeTestService {
  constructor(
    private readonly store: Store,
    private readonly connectors: Connectors,
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

    const scope = buildScope(input.sampleInput);
    const inputs = resolveInputs(node.params, scope);
    return def.execute({
      inputs,
      params: node.params,
      rt: {
        kv: this.store.kv,
        credentials: this.store.credentials,
        connectors: this.connectors,
        runId: "test",
        workflowRunId: "test",
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
