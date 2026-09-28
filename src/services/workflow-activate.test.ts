import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScheduleManager } from "../engine/schedule";
import { MemoryStore } from "../storage/memory/store";
import { WorkflowService } from "./workflow-service";
import "../nodes";

const graph = (cron: string) => ({
  trigger: { type: "schedule" as const, cron },
  nodes: [
    { id: "tick", type: "trigger.schedule", params: { cron } },
    { id: "log", type: "util.log", params: { message: "hi" } },
  ],
  edges: [{ from: { nodeId: "tick", port: "out" }, to: { nodeId: "log", port: "in" } }],
});

function schedules(fail: boolean) {
  const calls: string[] = [];
  const mgr: ScheduleManager = {
    async register(id, cron) {
      calls.push(`register ${cron}`);
      if (fail) throw new Error("redis down");
    },
    async unregister() {
      calls.push("unregister");
    },
  };
  return { mgr, calls };
}

test("activate: a failed schedule registration leaves the workflow inactive", async () => {
  const store = new MemoryStore();
  const { mgr } = schedules(true);
  const svc = new WorkflowService(store, mgr);
  const { workflow, version } = await svc.create("o", { name: "report", ...graph("32 * * * *") } as never);

  await assert.rejects(svc.activate("o", workflow.id, version.id), /redis down/);
  const after = await svc.get("o", workflow.id);
  assert.notEqual(after.status, "active");
  assert.equal(after.activeVersionId, null);
});

test("activate: a failed re-registration keeps the previously active version", async () => {
  const store = new MemoryStore();
  const ok = schedules(false);
  const svc = new WorkflowService(store, ok.mgr);
  const { workflow, version: v1 } = await svc.create("o", { name: "report", ...graph("32 * * * *") } as never);
  await svc.activate("o", workflow.id, v1.id);

  const v2 = await svc.update("o", workflow.id, { name: "report", ...graph("0 * * * *") } as never);
  const failing = new WorkflowService(store, schedules(true).mgr);
  await assert.rejects(failing.activate("o", workflow.id, v2.id), /redis down/);
  const after = await svc.get("o", workflow.id);
  assert.equal(after.status, "active");
  assert.equal(after.activeVersionId, v1.id);
});

test("activate: registers the schedule before switching the version", async () => {
  const store = new MemoryStore();
  const { mgr, calls } = schedules(false);
  const svc = new WorkflowService(store, mgr);
  const { workflow, version } = await svc.create("o", { name: "report", ...graph("32 * * * *") } as never);
  await svc.activate("o", workflow.id, version.id);
  assert.deepEqual(calls, ["register 32 * * * *"]);
  const after = await svc.get("o", workflow.id);
  assert.equal(after.status, "active");
  assert.equal(after.activeVersionId, version.id);
});
