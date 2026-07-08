import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connectors } from "../../connectors";
import { dryRunConnectors } from "../../connectors/default";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore } from "../../ports";
import { MemoryConversationStore } from "../../storage/memory/conversation-store";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeRuntime } from "../define";
import { aiAgent, aiComplete } from "./ai";
import "../index"; // register the catalog so getNode works for tools

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

function rt(overrides: Partial<NodeRuntime> = {}): NodeRuntime {
  return {
    kv: new MemoryKVState(),
    credentials: nullCreds,
    connectors: dryRunConnectors(),
    conversations: new MemoryConversationStore(),
    ownerId: "o",
    runId: "r",
    workflowRunId: "wr",
    stepId: "s",
    ...overrides,
  };
}

test("ai.complete memory persists turns and feeds history back (owner-scoped)", async () => {
  const conversations = new MemoryConversationStore();
  let lastMessages: Array<{ content: string }> = [];
  const connectors: Connectors = {
    ...dryRunConnectors(),
    ai: {
      ...dryRunConnectors().ai,
      async complete(_c, input) {
        lastMessages = input.messages;
        return { text: "reply", model: input.model, dryRun: true };
      },
    },
  };
  const shared = rt({ conversations, connectors });

  await aiComplete.execute!({ inputs: { model: "m", prompt: "hi", memory: { key: "u1" } }, params: {}, rt: shared });
  let history = await conversations.load("o:u1");
  assert.deepEqual(
    history.map((h) => `${h.role}:${h.content}`),
    ["user:hi", "assistant:reply"],
  );

  await aiComplete.execute!({ inputs: { model: "m", prompt: "again", memory: { key: "u1" } }, params: {}, rt: shared });
  // the 2nd call's messages include the prior turn + the new prompt
  assert.deepEqual(
    lastMessages.map((m) => m.content),
    ["hi", "reply", "again"],
  );
  history = await conversations.load("o:u1");
  assert.equal(history.length, 4);
});

test("ai.agent runs the tool loop and returns the final answer + trace", async () => {
  let step = 0;
  const connectors: Connectors = {
    ...dryRunConnectors(),
    ai: {
      ...dryRunConnectors().ai,
      async chat() {
        if (step++ === 0) {
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
  };

  const out = await aiAgent.execute!({
    inputs: { model: "m", prompt: "set x", tools: [{ tool: "data.set" }], maxSteps: 5 },
    params: {},
    rt: rt({ connectors }),
  });

  const data = out.data as { text: string; steps: number; toolCalls: Array<{ tool: string; result: string }> };
  assert.equal(data.text, "done");
  assert.equal(data.steps, 1);
  assert.equal(data.toolCalls[0]?.tool, "data.set");
  assert.match(data.toolCalls[0]?.result ?? "", /"x":1/);
});

test("ai.agent rejects an unknown tool node at setup", async () => {
  await assert.rejects(
    () =>
      aiAgent.execute!({
        inputs: { model: "m", prompt: "x", tools: [{ tool: "does.not.exist" }], maxSteps: 3 },
        params: {},
        rt: rt(),
      }),
    /unknown tool node/,
  );
});

test("ai.agent gates a requireApproval tool: denied → not run, fed back to model", async () => {
  let round = 0;
  const connectors: Connectors = {
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
        return { message: { role: "assistant", content: "ok" }, content: "ok", toolCalls: [], dryRun: false };
      },
    },
  };

  // DENIED with feedback → feedback is surfaced to the model in the tool result
  const denied = await aiAgent.execute!({
    inputs: { model: "m", prompt: "go", tools: [{ tool: "data.set", requireApproval: true }], maxSteps: 5 },
    params: {},
    rt: rt({
      connectors,
      // mirrors POST /approvals { approved:false, data:{ feedback } } → eventData
      waitForEvent: async () => ({ timedOut: false, data: { approved: false, data: { feedback: "make it shorter" } } }),
    }),
  });
  const dData = denied.data as { toolCalls: Array<{ approved?: boolean; result: string }> };
  assert.equal(dData.toolCalls[0]?.approved, false);
  const dResult = dData.toolCalls[0]?.result ?? "";
  assert.match(dResult, /Revise using the feedback/);
  assert.match(dResult, /make it shorter/); // human feedback reached the model

  // APPROVED
  round = 0;
  const approved = await aiAgent.execute!({
    inputs: { model: "m", prompt: "go", tools: [{ tool: "data.set", requireApproval: true }], maxSteps: 5 },
    params: {},
    rt: rt({ connectors, waitForEvent: async () => ({ timedOut: false, data: { approved: true } }) }),
  });
  const aData = approved.data as { toolCalls: Array<{ approved?: boolean; result: string }> };
  assert.equal(aData.toolCalls[0]?.approved, true);
  assert.match(aData.toolCalls[0]?.result ?? "", /"x":1/);
});
