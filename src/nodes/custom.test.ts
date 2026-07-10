import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connectors, HttpInput } from "../connectors";
import { dryRunConnectors } from "../connectors/default";
import type { CustomNodeDef } from "../domain/types";
import { DryRunService } from "../services/dry-run-service";
import { MemoryStore } from "../storage/memory/store";
import { customNodeDefinition } from "./custom";
import type { NodeRuntime } from "./define";
import "./index";

function def(overrides: Partial<CustomNodeDef> = {}): CustomNodeDef {
  return {
    id: "nd",
    ownerId: "o",
    type: "custom.tg.send",
    label: "TG Send",
    app: "telegram",
    category: "Telegram",
    fields: [{ name: "chatId", type: "string", required: true }],
    request: {
      method: "POST",
      url: "https://api.telegram.org/bot{{ $secret.botToken }}/sendMessage",
      body: { chat_id: "{{ chatId }}", text: "{{ text }}" },
    },
    outputs: ["success", "error"],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

test("custom node execute fills the HTTP template from fields + {{ $secret }}", async () => {
  const store = new MemoryStore();
  await store.credentials.put({ id: "c1", ownerId: "o", type: "telegram", secret: { botToken: "T0K3N" } });

  let captured: HttpInput | undefined;
  const connectors: Connectors = {
    ...dryRunConnectors(),
    http: {
      async request(input) {
        captured = input;
        return { status: 200, body: { ok: true } };
      },
    },
  };
  const rt: NodeRuntime = {
    kv: store.kv, credentials: store.credentials, connections: store.connections,
    connectors, conversations: store.conversations, ownerId: "o",
    runId: "r", workflowRunId: "wr", stepId: "s",
  };

  const node = customNodeDefinition(def());
  const out = await node.execute!({ inputs: { chatId: "123", text: "hi", credentialId: "c1" }, params: { credentialId: "c1" }, rt });

  assert.equal(out.port, "success");
  assert.equal(captured?.url, "https://api.telegram.org/botT0K3N/sendMessage"); // $secret filled
  assert.deepEqual(captured?.body, { chat_id: "123", text: "hi" }); // field refs filled
});

test("custom node validates + runs end-to-end via dry-run", async () => {
  const store = new MemoryStore();
  await store.nodeDefs.create(def({ id: "nd1", type: "custom.echo", fields: [{ name: "msg", type: "string", required: true }], request: { method: "POST", url: "https://api.example.com/echo", body: { text: "{{ msg }}" } } }));

  const res = await new DryRunService(store).run("o", {
    trigger: { type: "manual" },
    nodes: [
      { id: "t", type: "trigger.manual", params: {} },
      { id: "e", type: "custom.echo", params: { msg: "hi {{ trigger.name }}" } },
    ],
    edges: [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e", port: "in" } }],
    input: { name: "Ada" },
  });

  assert.equal(res.ok, true); // resolver recognized custom.echo; executor ran it
  assert.deepEqual(res.outputs.e, { status: 200, body: { dryRun: true } }); // dry http stub
});
