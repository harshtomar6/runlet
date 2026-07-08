import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../connectors/default";
import type { DecryptedSecret, WorkflowVersion } from "../domain/types";
import type { CredentialStore } from "../ports";
import { LocalExecutionContext, type EventResolver } from "./local-context";
import { runWorkflow } from "./interpreter";
import { MemoryEventSink } from "./sink";
import { MemoryConversationStore } from "../storage/memory/conversation-store";
import { MemoryKVState } from "../storage/memory/kv-state";
import "../nodes";

const nullCreds: CredentialStore = {
  async get(): Promise<DecryptedSecret> {
    throw new Error("no creds");
  },
  async put() {},
  async list() {
    return [];
  },
  async delete() {
    return false;
  },
};

const base = { id: "v", workflowId: "w", version: 1, createdAt: new Date() };

// trigger → approval → (approved) e-yes / (rejected) e-no
const def: WorkflowVersion = {
  ...base,
  nodes: [
    { id: "t", type: "trigger.manual", params: {} },
    { id: "gate", type: "control.approval", params: { message: "ok?" } },
    { id: "yes", type: "email.send", params: { to: "a@b.com", templateId: "yes" } },
    { id: "no", type: "email.send", params: { to: "a@b.com", templateId: "no" } },
  ],
  edges: [
    { from: { nodeId: "t", port: "out" }, to: { nodeId: "gate", port: "in" } },
    { from: { nodeId: "gate", port: "approved" }, to: { nodeId: "yes", port: "in" } },
    { from: { nodeId: "gate", port: "rejected" }, to: { nodeId: "no", port: "in" } },
  ],
};

async function run(resolver?: EventResolver) {
  const sink = new MemoryEventSink();
  const exec = new LocalExecutionContext("t", false, resolver);
  await runWorkflow(exec, {
    runId: "t",
    def,
    trigger: {},
    sink,
    rt: {
      kv: new MemoryKVState(),
      credentials: nullCreds,
      connectors: dryRunConnectors(),
      conversations: new MemoryConversationStore(),
      ownerId: "o",
    },
  });
  const executed = sink.events.filter((e) => e.type === "node.executed").map((e) => e.nodeId);
  return { sink, exec, executed };
}

test("control.approval routes to approved (auto-approve) and records the wait", async () => {
  const { exec, executed } = await run(); // default resolver → approved
  assert.ok(executed.includes("yes"));
  assert.ok(!executed.includes("no"));
  assert.equal(exec.waits.length, 1);
  assert.match(exec.waits[0]?.eventId ?? "", /^approval:/);
});

test("control.approval routes to rejected when the decision is not approved", async () => {
  const { executed } = await run(() => ({ timedOut: false, data: { approved: false } }));
  assert.ok(executed.includes("no"));
  assert.ok(!executed.includes("yes"));
});

test("control.approval routes to rejected on timeout", async () => {
  const { executed } = await run(() => ({ timedOut: true, data: null }));
  assert.ok(executed.includes("no"));
  assert.ok(!executed.includes("yes"));
});

test("ai.agent runs each round + tool call as its own durable sub-step", async () => {
  let round = 0;
  const connectors = {
    ...dryRunConnectors(),
    ai: {
      ...dryRunConnectors().ai,
      async chat() {
        if (round++ === 0) {
          return {
            message: { role: "assistant", content: "", tool_calls: [] },
            content: "",
            toolCalls: [{ id: "c1", name: "data_set", args: { fields: { x: 1 } } }],
            dryRun: false,
          };
        }
        return { message: { role: "assistant", content: "done" }, content: "done", toolCalls: [], dryRun: false };
      },
    },
  } as unknown as import("../connectors").Connectors;

  const agentDef: WorkflowVersion = {
    ...base,
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "agent", type: "ai.agent", params: { model: "m", prompt: "go", tools: [{ tool: "data.set" }], maxSteps: 5 } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "agent", port: "in" } }],
  };

  const exec = new LocalExecutionContext("t");
  await runWorkflow(exec, {
    runId: "t",
    def: agentDef,
    trigger: {},
    sink: new MemoryEventSink(),
    rt: {
      kv: new MemoryKVState(),
      credentials: nullCreds,
      connectors,
      conversations: new MemoryConversationStore(),
      ownerId: "o",
    },
  });

  // durable node → sub-steps at top level (not one wrapping node step)
  assert.ok(exec.steps.includes("node:agent:round-0"));
  assert.ok(exec.steps.includes("node:agent:tool-0-c1"));
  assert.ok(exec.steps.includes("node:agent:round-1"));
  assert.ok(exec.steps.includes("node:agent:started"));
  assert.ok(exec.steps.includes("node:agent:executed"));
});
