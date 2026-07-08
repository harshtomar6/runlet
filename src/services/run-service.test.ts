import assert from "node:assert/strict";
import { test } from "node:test";
import { newId } from "../domain/ids";
import type { Workflow, WorkflowVersion } from "../domain/types";
import { LocalDispatcher } from "../engine/dispatch";
import { MemoryStore } from "../storage/memory/store";
import { RunService } from "./run-service";
import "../nodes";

async function seed(store: MemoryStore, ownerId: string): Promise<{ workflowId: string; versionId: string }> {
  const now = new Date();
  const wf: Workflow = {
    id: newId(),
    ownerId,
    name: "wf",
    status: "active",
    activeVersionId: null,
    trigger: { type: "manual" },
    createdAt: now,
    updatedAt: now,
  };
  const v: WorkflowVersion = {
    id: newId(),
    workflowId: wf.id,
    version: 1,
    createdAt: now,
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "e", type: "email.send", params: { to: "a@b.com", templateId: "x" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e", port: "in" } }],
  };
  await store.workflows.putWorkflow(wf);
  await store.workflows.createVersion(v);
  await store.workflows.activate(wf.id, v.id);
  return { workflowId: wf.id, versionId: v.id };
}

test("run detail, listing, and metrics are owner-scoped", async () => {
  const store = new MemoryStore();
  const { workflowId, versionId } = await seed(store, "owner-1");
  const dispatcher = new LocalDispatcher(store);

  const { runId } = await dispatcher.start({ ownerId: "owner-1", workflowId, versionId, trigger: {} });

  const svc = new RunService(store);

  const list = await svc.list("owner-1", {});
  assert.equal(list.length, 1);
  assert.equal(list[0]?.runId, runId);
  assert.equal(list[0]?.stepCount, 1); // one email node executed

  const detail = await svc.get("owner-1", runId);
  assert.equal(detail.run.ownerId, "owner-1");
  assert.equal(detail.run.status, "succeeded");
  assert.ok(detail.events.some((e) => e.type === "run.succeeded"));

  const metrics = await svc.metrics("owner-1", {});
  assert.deepEqual(metrics.byStatus, { succeeded: 1 });
  assert.equal(metrics.totalSteps, 1);
  assert.equal(metrics.successRate, 1);

  assert.equal((await svc.list("owner-2", {})).length, 0);
});

test("metrics computes successRate over mixed statuses and empty is 0", async () => {
  const store = new MemoryStore();
  const base = { ownerId: "o", workflowId: "w", versionId: "v", trigger: {}, workflowRunId: null, startedAt: new Date(), finishedAt: new Date() };
  await store.events.createRun({ id: "r1", status: "succeeded", ...base });
  await store.events.createRun({ id: "r2", status: "succeeded", ...base });
  await store.events.createRun({ id: "r3", status: "failed", ...base });

  const svc = new RunService(store);
  const m = await svc.metrics("o", {});
  assert.equal(m.total, 3);
  assert.deepEqual(m.byStatus, { succeeded: 2, failed: 1 });
  assert.ok(Math.abs(m.successRate - 2 / 3) < 1e-9);

  const empty = await svc.metrics("nobody", {});
  assert.equal(empty.total, 0);
  assert.equal(empty.successRate, 0); // guarded, no NaN
});
