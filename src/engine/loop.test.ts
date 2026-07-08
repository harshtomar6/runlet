import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../connectors/default";
import type { CredentialStore } from "../ports";
import type { DecryptedSecret, WorkflowVersion } from "../domain/types";
import { LocalExecutionContext } from "./local-context";
import { runWorkflow } from "./interpreter";
import { MemoryEventSink } from "./sink";
import { MemoryKVState } from "../storage/memory/kv-state";
import "../nodes";

const nullCredentials: CredentialStore = {
  async get(): Promise<DecryptedSecret> {
    throw new Error("no credentials");
  },
  async put() {},
  async list() {
    return [];
  },
  async delete() {},
};

async function run(def: WorkflowVersion, trigger: unknown) {
  const sink = new MemoryEventSink();
  const exec = new LocalExecutionContext("t");
  await runWorkflow(exec, {
    runId: "t",
    def,
    trigger,
    sink,
    rt: { kv: new MemoryKVState(), credentials: nullCredentials, connectors: dryRunConnectors() },
  });
  return { sink, exec };
}

const base = { id: "v", workflowId: "w", version: 1, createdAt: new Date() };

test("control.loop runs its body N times, then continues via done", async () => {
  const { sink, exec } = await run(
    {
      ...base,
      nodes: [
        { id: "t", type: "trigger.manual", params: {} },
        { id: "loop", type: "control.loop", params: { times: "{{ trigger.count }}" } },
        { id: "e", type: "email.send", params: { to: "a@b.com", templateId: "drip" } },
        { id: "w", type: "control.wait", params: { duration: "1d" } },
        { id: "done", type: "email.send", params: { to: "a@b.com", templateId: "final" } },
      ],
      edges: [
        { from: { nodeId: "t", port: "out" }, to: { nodeId: "loop", port: "in" } },
        { from: { nodeId: "loop", port: "each" }, to: { nodeId: "e", port: "in" } },
        { from: { nodeId: "e", port: "success" }, to: { nodeId: "w", port: "in" } },
        { from: { nodeId: "loop", port: "done" }, to: { nodeId: "done", port: "in" } },
      ],
    },
    { count: 3 },
  );

  const emailRuns = sink.events.filter((e) => e.type === "node.executed" && e.nodeId === "e").length;
  assert.equal(emailRuns, 3); // body ran 3×
  assert.equal(exec.sleeps.length, 3); // one wait per iteration
  // distinct, iteration-scoped sleep step ids keep durability sound
  assert.equal(new Set(exec.sleeps.map((s) => s.stepId)).size, 3);
  assert.ok(sink.events.some((e) => e.type === "node.executed" && e.nodeId === "done"));
});

test("JSONata expressions resolve nested + comparison", async () => {
  const { sink } = await run(
    {
      ...base,
      nodes: [
        { id: "t", type: "trigger.manual", params: {} },
        { id: "cond", type: "control.if", params: { condition: "{{ trigger.items[0].qty > 1 }}" } },
        { id: "yes", type: "email.send", params: { to: "{{ trigger.items[0].email }}", templateId: "y" } },
      ],
      edges: [
        { from: { nodeId: "t", port: "out" }, to: { nodeId: "cond", port: "in" } },
        { from: { nodeId: "cond", port: "true" }, to: { nodeId: "yes", port: "in" } },
      ],
    },
    { items: [{ qty: 5, email: "a@b.com" }] },
  );

  assert.ok(sink.events.some((e) => e.type === "node.executed" && e.nodeId === "yes"));
});
