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

test("test-node validates resolved inputs (missing → 400-style error)", async () => {
  const store = new MemoryStore();
  const now = new Date();
  const id = newId();
  await store.workflows.putWorkflow({
    id, ownerId: "o1", name: "wf", status: "draft", activeVersionId: null,
    trigger: { type: "event", eventType: "e" }, createdAt: now, updatedAt: now,
  });
  await store.workflows.createVersion({
    id: newId(), workflowId: id, version: 1, createdAt: now,
    // to resolves to undefined (no trigger.email) → schema fails
    nodes: [{ id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "t" } }],
    edges: [],
  });
  const svc = new NodeTestService(store, dryRunConnectors());
  await assert.rejects(
    () => svc.testNode("o1", id, { nodeId: "e1", sampleInput: {} }),
    /Resolved inputs failed validation/,
  );
});

test("test-node is dry-run by default; real connectors only on opt-in", async () => {
  const store = new MemoryStore();
  const now = new Date();
  const id = newId();
  await store.workflows.putWorkflow({
    id, ownerId: "o1", name: "wf", status: "draft", activeVersionId: null,
    trigger: { type: "event", eventType: "e" }, createdAt: now, updatedAt: now,
  });
  await store.workflows.createVersion({
    id: newId(), workflowId: id, version: 1, createdAt: now,
    nodes: [{ id: "e1", type: "email.send", params: { to: "a@b.com", templateId: "t" } }],
    edges: [],
  });

  const sent: string[] = [];
  const recording = {
    email: { async send(_c: unknown, i: { to: string }) { sent.push(i.to); return { id: "real", dryRun: false }; } },
    slack: { async post() { return { ok: true, dryRun: false }; } },
    http: { async request() { return { status: 200, body: {} }; } },
  } as unknown as import("../connectors").Connectors;
  const svc = new NodeTestService(store, recording);

  await svc.testNode("o1", id, { nodeId: "e1" }); // default dryRun → recording NOT used
  assert.deepEqual(sent, []);

  const out = await svc.testNode("o1", id, { nodeId: "e1", dryRun: false }); // opt-in → real
  assert.deepEqual(sent, ["a@b.com"]);
  assert.equal((out.data as { dryRun: boolean }).dryRun, false);
});
