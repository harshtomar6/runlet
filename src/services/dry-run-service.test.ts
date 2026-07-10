import assert from "node:assert/strict";
import { test } from "node:test";
import type { TriggerConfig } from "../domain/types";
import { MemoryStore } from "../storage/memory/store";
import { DryRunService } from "./dry-run-service";
import "../nodes";

const trigger: TriggerConfig = { type: "manual" };

test("dry-run simulates the graph and returns per-node outputs (no side effects)", async () => {
  const svc = new DryRunService(new MemoryStore());
  const res = await svc.run("o", {
    trigger,
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "log", type: "util.log", params: { message: "hi {{ trigger.name }}" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "log", port: "in" } }],
    input: { name: "Ada" },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.outputs.log, { message: "hi Ada" }); // expression resolved against the sample input
});

test("dry-run structurally validates first (bad expression syntax → not run)", async () => {
  const svc = new DryRunService(new MemoryStore());
  const res = await svc.run("o", {
    trigger,
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "log", type: "util.log", params: { message: "{{ foo.. }}" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "log", port: "in" } }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.events.length, 0); // never executed
  assert.ok(res.validation.errors.some((e) => e.code === "invalid_expression"));
});

test("dry-run surfaces a runtime failure with the failing node + partial trace", async () => {
  const svc = new DryRunService(new MemoryStore());
  const res = await svc.run("o", {
    trigger,
    // `to` resolves to undefined at runtime (no trigger.email) → fails validation of resolved inputs
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "e", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "d" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e", port: "in" } }],
    input: {},
  });
  assert.equal(res.ok, false);
  assert.ok(res.error);
  assert.ok(res.events.some((ev) => ev.type === "node.failed" && ev.nodeId === "e"));
});
