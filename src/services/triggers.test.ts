import assert from "node:assert/strict";
import { test } from "node:test";
import { newId } from "../domain/ids";
import type { Workflow, WorkflowVersion } from "../domain/types";
import { LocalDispatcher } from "../engine/dispatch";
import { MemoryStore } from "../storage/memory/store";
import { SubscriptionService } from "./subscription-service";
import { TriggerService } from "./trigger-service";
import "../nodes";

async function seedActiveWorkflow(store: MemoryStore, ownerId: string): Promise<string> {
  const now = new Date();
  const wf: Workflow = {
    id: newId(),
    ownerId,
    name: "welcome",
    status: "active",
    activeVersionId: null,
    trigger: { type: "event", eventType: "app.installed" },
    createdAt: now,
    updatedAt: now,
  };
  const version: WorkflowVersion = {
    id: newId(),
    workflowId: wf.id,
    version: 1,
    createdAt: now,
    nodes: [
      { id: "t", type: "trigger.event", params: { eventType: "app.installed" } },
      { id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "welcome" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e1", port: "in" } }],
  };
  await store.workflows.putWorkflow(wf);
  await store.workflows.createVersion(version);
  await store.workflows.activate(wf.id, version.id);
  return wf.id;
}

test("an event fans out to subscribed workflows and starts a run", async () => {
  const store = new MemoryStore();
  const owner = "owner-1";
  const workflowId = await seedActiveWorkflow(store, owner);

  const triggers = new TriggerService(store, new LocalDispatcher(store));
  const subs = new SubscriptionService(store, triggers);

  await subs.create(owner, { eventType: "app.installed", workflowId });

  const result = await subs.dispatchEvent(owner, "app.installed", { email: "a@b.com" });

  assert.equal(result.triggered.length, 1);
  const runId = result.triggered[0]?.runId ?? "";
  const run = await store.events.getRun(runId);
  assert.equal(run.status, "succeeded");

  const executed = (await store.events.listEvents(runId))
    .filter((e) => e.type === "node.executed")
    .map((e) => e.nodeId);
  assert.deepEqual(executed, ["e1"]);
});

test("events for other owners do not trigger this owner's workflows", async () => {
  const store = new MemoryStore();
  const workflowId = await seedActiveWorkflow(store, "owner-1");
  const triggers = new TriggerService(store, new LocalDispatcher(store));
  const subs = new SubscriptionService(store, triggers);
  await subs.create("owner-1", { eventType: "app.installed", workflowId });

  const result = await subs.dispatchEvent("owner-2", "app.installed", {});
  assert.equal(result.triggered.length, 0);
});

async function seedDraftWorkflow(store: MemoryStore, ownerId: string): Promise<string> {
  const now = new Date();
  const id = newId();
  await store.workflows.putWorkflow({
    id,
    ownerId,
    name: "draft",
    status: "draft",
    activeVersionId: null,
    trigger: { type: "event", eventType: "app.installed" },
    createdAt: now,
    updatedAt: now,
  });
  await store.workflows.createVersion({
    id: newId(),
    workflowId: id,
    version: 1,
    createdAt: now,
    nodes: [{ id: "t", type: "trigger.event", params: { eventType: "app.installed" } }],
    edges: [],
  });
  return id;
}

test("draft (never-activated) workflows are not triggerable", async () => {
  const store = new MemoryStore();
  const draftId = await seedDraftWorkflow(store, "owner-1");
  const triggers = new TriggerService(store, new LocalDispatcher(store));
  await assert.rejects(() => triggers.runWorkflowNow(draftId, {}), /not active/);
});

test("fan-out isolates failures: a draft subscription doesn't block active ones", async () => {
  const store = new MemoryStore();
  const owner = "owner-1";
  const activeId = await seedActiveWorkflow(store, owner);
  const draftId = await seedDraftWorkflow(store, owner);

  const triggers = new TriggerService(store, new LocalDispatcher(store));
  const subs = new SubscriptionService(store, triggers);
  await subs.create(owner, { eventType: "app.installed", workflowId: activeId });
  await subs.create(owner, { eventType: "app.installed", workflowId: draftId });

  const result = await subs.dispatchEvent(owner, "app.installed", { email: "a@b.com" });
  assert.equal(result.triggered.length, 1);
  assert.equal(result.triggered[0]?.workflowId, activeId);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]?.workflowId, draftId);
});
