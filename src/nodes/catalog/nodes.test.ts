import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../../connectors/default";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore } from "../../ports";
import { MemoryConversationStore } from "../../storage/memory/conversation-store";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeExecArgs, NodeRuntime } from "../define";
import type { Connectors } from "../../connectors";
import { httpRequest, smtpSend } from "./actions";
import { filterNode, switchNode } from "./control";
import { dataTransform } from "./data";
import { logNode } from "./util";

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

function rt(): NodeRuntime {
  return {
    kv: new MemoryKVState(),
    credentials: nullCreds,
    connectors: dryRunConnectors(),
    conversations: new MemoryConversationStore(),
    ownerId: "o",
    runId: "r",
    workflowRunId: "wr",
    stepId: "s1",
  };
}

function args(inputs: Record<string, unknown>): NodeExecArgs {
  return { inputs, params: inputs, rt: rt() };
}

test("control.switch routes to the matching case, else default", async () => {
  assert.equal((await switchNode.execute!(args({ value: "b", cases: [{ equals: "a" }, { equals: "b" }] }))).port, "1");
  assert.equal((await switchNode.execute!(args({ value: "z", cases: [{ equals: "a" }] }))).port, "default");
});

test("control.filter continues on truthy, halts on falsy", async () => {
  assert.equal((await filterNode.execute!(args({ condition: 1 }))).port, "out");
  assert.equal((await filterNode.execute!(args({ condition: 0 }))).port, "stop");
});

test("data.transform outputs the resolved value", async () => {
  const out = await dataTransform.execute!(args({ value: { a: 1 } }));
  assert.deepEqual(out.data, { a: 1 });
});

test("util.log passes the message through", async () => {
  const out = await logNode.execute!(args({ message: "hi", level: "info" }));
  assert.deepEqual(out.data, { message: "hi" });
});

test("http.request: non-2xx is success by default, fails only with failOnError", async () => {
  const http500: Connectors = {
    ...dryRunConnectors(),
    http: { async request() { return { status: 500, body: { error: "boom" } }; } },
  };
  const rtWith500: NodeRuntime = { ...rt(), connectors: http500 };

  // default: a 500 comes back as a successful node with the status.
  const ok = await httpRequest.execute!({ inputs: { method: "GET", url: "https://x" }, params: {}, rt: rtWith500 });
  assert.equal(ok.port, "success");
  assert.equal((ok.data as { status: number }).status, 500);

  // failOnError: the node throws on a non-2xx status.
  await assert.rejects(
    () => httpRequest.execute!({ inputs: { method: "GET", url: "https://x", failOnError: true }, params: {}, rt: rtWith500 }),
    /HTTP 500/,
  );
});

test("email.smtp dry-runs without a credential", async () => {
  const out = await smtpSend.execute!(args({ to: "a@b.com", subject: "Hi" }));
  assert.equal(out.port, "success");
  assert.equal((out.data as { dryRun: boolean }).dryRun, true);
});

test("ai.complete dry-runs without a key and shapes prompt+system into messages", async () => {
  const { aiComplete } = await import("./ai");

  // dry-run via the dryRunConnectors provided by args()
  const dry = await aiComplete.execute!(args({ model: "openai/gpt-4o-mini", prompt: "hi" }));
  assert.equal(dry.port, "success");
  assert.equal((dry.data as { dryRun: boolean }).dryRun, true);

  // real path: a recording connector captures the shaped request
  let captured: unknown;
  const recording = {
    ...dryRunConnectors(),
    ai: {
      async complete(_c: unknown, input: unknown) {
        captured = input;
        return { text: "ok", model: "m", dryRun: false };
      },
    },
  } as unknown as import("../../connectors").Connectors;

  const out = await aiComplete.execute!({
    inputs: { model: "anthropic/claude-sonnet-4", prompt: "Summarize", system: "Be terse" },
    params: {},
    rt: { ...rt(), connectors: recording },
  });
  assert.equal((out.data as { text: string }).text, "ok");
  assert.deepEqual(captured, {
    model: "anthropic/claude-sonnet-4",
    messages: [
      { role: "system", content: "Be terse" },
      { role: "user", content: "Summarize" },
    ],
    temperature: undefined,
    maxTokens: undefined,
  });
});

test("ai.complete requires prompt or messages", async () => {
  const { aiComplete } = await import("./ai");
  await assert.rejects(() => aiComplete.execute!(args({ model: "x" })), /prompt.*or.*messages/);
});

test("ai media nodes dry-run without a key", async () => {
  const { aiImage, aiTranscribe, aiTts } = await import("./ai");

  const img = await aiImage.execute!(args({ model: "google/gemini-2.5-flash-image-preview", prompt: "a cat" }));
  assert.equal(img.port, "success");
  assert.deepEqual((img.data as { images: string[] }).images, []);
  assert.equal((img.data as { dryRun: boolean }).dryRun, true);

  const stt = await aiTranscribe.execute!(args({ model: "m", audio: "AAAA", format: "mp3" }));
  assert.equal((stt.data as { dryRun: boolean }).dryRun, true);

  const tts = await aiTts.execute!(args({ model: "m", text: "hello", format: "wav" }));
  assert.equal((tts.data as { format: string; dryRun: boolean }).format, "wav");
  assert.equal((tts.data as { dryRun: boolean }).dryRun, true);
});
