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

function run(def: WorkflowVersion, trigger: unknown) {
  const sink = new MemoryEventSink();
  const exec = new LocalExecutionContext("t");
  return runWorkflow(exec, {
    runId: "t",
    def,
    trigger,
    sink,
    rt: { kv: new MemoryKVState(), credentials: nullCredentials, connectors: dryRunConnectors() },
  }).then(() => ({ sink, exec }));
}

const base = { id: "v", workflowId: "w", version: 1, createdAt: new Date() };

test("runs nodes in order and records the sleep", async () => {
  const { sink, exec } = await run(
    {
      ...base,
      nodes: [
        { id: "t", type: "trigger.event", params: { eventType: "e" } },
        { id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "d1" } },
        { id: "w", type: "control.wait", params: { duration: "2h" } },
        { id: "e2", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "d2" } },
      ],
      edges: [
        { from: { nodeId: "t", port: "out" }, to: { nodeId: "e1", port: "in" } },
        { from: { nodeId: "e1", port: "success" }, to: { nodeId: "w", port: "in" } },
        { from: { nodeId: "w", port: "out" }, to: { nodeId: "e2", port: "in" } },
      ],
    },
    { email: "a@b.com" },
  );

  const executed = sink.events.filter((e) => e.type === "node.executed").map((e) => e.nodeId);
  assert.deepEqual(executed, ["e1", "e2"]);
  assert.equal(exec.sleeps.length, 1);
  assert.equal(exec.sleeps[0]?.seconds, 7200);
  assert.ok(sink.events.some((e) => e.type === "run.succeeded"));
});

test("control.if follows the true branch and skips the false branch", async () => {
  const def: WorkflowVersion = {
    ...base,
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "cond", type: "control.if", params: { condition: "{{ trigger.go }}" } },
      { id: "yes", type: "email.send", params: { to: "x@y.com", templateId: "yes" } },
      { id: "no", type: "email.send", params: { to: "x@y.com", templateId: "no" } },
    ],
    edges: [
      { from: { nodeId: "t", port: "out" }, to: { nodeId: "cond", port: "in" } },
      { from: { nodeId: "cond", port: "true" }, to: { nodeId: "yes", port: "in" } },
      { from: { nodeId: "cond", port: "false" }, to: { nodeId: "no", port: "in" } },
    ],
  };

  const { sink } = await run(def, { go: true });
  const executed = sink.events.filter((e) => e.type === "node.executed").map((e) => e.nodeId);
  assert.ok(executed.includes("yes"));
  assert.ok(!executed.includes("no"));
});

test("resolved inputs are validated before execute; missing required input fails fast", async () => {
  const sink = new MemoryEventSink();
  const exec = new LocalExecutionContext("t");
  const def: WorkflowVersion = {
    ...base,
    nodes: [
      { id: "t", type: "trigger.event", params: { eventType: "e" } },
      // trigger.email is absent → {{ trigger.email }} resolves to undefined
      { id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "d1" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e1", port: "in" } }],
  };

  await assert.rejects(() =>
    runWorkflow(exec, {
      runId: "t",
      def,
      trigger: {}, // no email
      sink,
      rt: { kv: new MemoryKVState(), credentials: nullCredentials, connectors: dryRunConnectors() },
    }),
  );

  assert.ok(sink.events.some((e) => e.type === "node.failed" && e.nodeId === "e1"));
  assert.ok(!sink.events.some((e) => e.type === "node.executed"));
  assert.ok(!sink.events.some((e) => e.type === "run.succeeded"));
  assert.equal(sink.events.filter((e) => e.type === "run.started").length, 1);
});
