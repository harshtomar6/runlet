import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../connectors/default";
import { newId } from "../domain/ids";
import type { Workflow, WorkflowVersion } from "../domain/types";
import { MemoryStore } from "../storage/memory/store";
import { NodeTestService } from "./node-test-service";
import "../nodes";

test("test-node runs a single node with sample input", async () => {
  const store = new MemoryStore();
  const now = new Date();
  const wf: Workflow = {
    id: newId(),
    ownerId: "o1",
    name: "wf",
    status: "draft",
    activeVersionId: null,
    trigger: { type: "event", eventType: "e" },
    createdAt: now,
    updatedAt: now,
  };
  const v: WorkflowVersion = {
    id: newId(),
    workflowId: wf.id,
    version: 1,
    createdAt: now,
    nodes: [{ id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "welcome" } }],
    edges: [],
  };
  await store.workflows.putWorkflow(wf);
  await store.workflows.createVersion(v);

  const svc = new NodeTestService(store, dryRunConnectors());
  const outcome = await svc.testNode("o1", wf.id, { nodeId: "e1", sampleInput: { email: "a@b.com" } });

  assert.equal(outcome.port, "success");
  assert.equal((outcome.data as { dryRun: boolean }).dryRun, true);

  await assert.rejects(() => svc.testNode("o1", wf.id, { nodeId: "nope" }));
  await assert.rejects(() => svc.testNode("o2", wf.id, { nodeId: "e1" })); // wrong owner
});
