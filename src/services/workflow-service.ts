import { newId } from "../domain/ids";
import type { CreateWorkflowInput, UpdateWorkflowInput } from "../domain/schemas";
import type { Workflow, WorkflowVersion } from "../domain/types";
import { ApiError, ValidationFailed } from "../errors";
import { NotFoundError } from "../ports/errors";
import type { Store, WorkflowFilter } from "../ports";
import { validateGraph, type ValidationResult } from "./validation";

/**
 * Business logic for workflow definitions: CRUD, immutable versioning, and
 * activation. Trigger registration (schedules/webhooks) lands in M4.
 */
export class WorkflowService {
  constructor(private readonly store: Store) {}

  async create(
    ownerId: string,
    input: CreateWorkflowInput,
  ): Promise<{ workflow: Workflow; version: WorkflowVersion }> {
    const now = new Date();
    const workflow: Workflow = {
      id: newId(),
      ownerId,
      name: input.name,
      status: "draft",
      activeVersionId: null,
      trigger: input.trigger,
      createdAt: now,
      updatedAt: now,
    };
    const version: WorkflowVersion = {
      id: newId(),
      workflowId: workflow.id,
      version: 1,
      nodes: input.nodes,
      edges: input.edges,
      createdAt: now,
    };
    await this.store.workflows.putWorkflow(workflow);
    await this.store.workflows.createVersion(version);
    return { workflow, version };
  }

  async get(ownerId: string, id: string): Promise<Workflow> {
    const wf = await this.store.workflows.getWorkflow(id);
    this.assertOwner(ownerId, wf);
    return wf;
  }

  async list(ownerId: string, filter?: WorkflowFilter): Promise<Workflow[]> {
    return this.store.workflows.list(ownerId, filter);
  }

  /** Editing creates a new immutable version and updates header fields. */
  async update(ownerId: string, id: string, input: UpdateWorkflowInput): Promise<WorkflowVersion> {
    const wf = await this.get(ownerId, id);
    const versions = await this.store.workflows.listVersions(id); // newest first
    const nextVersion = (versions[0]?.version ?? 0) + 1;
    const now = new Date();

    const version: WorkflowVersion = {
      id: newId(),
      workflowId: id,
      version: nextVersion,
      nodes: input.nodes,
      edges: input.edges,
      createdAt: now,
    };
    await this.store.workflows.createVersion(version);
    await this.store.workflows.putWorkflow({
      ...wf,
      name: input.name ?? wf.name,
      trigger: input.trigger ?? wf.trigger,
      updatedAt: now,
    });
    return version;
  }

  async remove(ownerId: string, id: string): Promise<void> {
    await this.get(ownerId, id); // owner + existence check
    await this.store.workflows.setStatus(id, "disabled");
  }

  async listVersions(ownerId: string, id: string): Promise<WorkflowVersion[]> {
    await this.get(ownerId, id);
    return this.store.workflows.listVersions(id);
  }

  /** Validate a specific version, or the latest if versionId is omitted. */
  async validate(ownerId: string, id: string, versionId?: string): Promise<ValidationResult> {
    const wf = await this.get(ownerId, id);
    const version = await this.resolveVersion(id, versionId);
    return validateGraph({ trigger: wf.trigger, nodes: version.nodes, edges: version.edges });
  }

  /** Activate a version after it passes validation. */
  async activate(ownerId: string, id: string, versionId: string): Promise<void> {
    const wf = await this.get(ownerId, id);
    const version = await this.store.workflows.getVersion(id, versionId);
    const result = validateGraph({ trigger: wf.trigger, nodes: version.nodes, edges: version.edges });
    if (!result.ok) throw new ValidationFailed(result.errors);
    await this.store.workflows.activate(id, versionId);
  }

  async disable(ownerId: string, id: string): Promise<void> {
    await this.get(ownerId, id);
    await this.store.workflows.setStatus(id, "disabled");
  }

  private async resolveVersion(workflowId: string, versionId?: string): Promise<WorkflowVersion> {
    if (versionId) return this.store.workflows.getVersion(workflowId, versionId);
    const versions = await this.store.workflows.listVersions(workflowId);
    const latest = versions[0];
    if (!latest) throw new NotFoundError("WorkflowVersion", `${workflowId}:latest`);
    return latest;
  }

  private assertOwner(ownerId: string, wf: Workflow): void {
    // Treat cross-tenant access as "not found" to avoid leaking existence.
    if (wf.ownerId !== ownerId) throw new ApiError(404, "not_found", "Workflow not found");
  }
}
