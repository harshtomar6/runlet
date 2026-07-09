import assert from "node:assert/strict";
import { test } from "node:test";
import type { Connectors, SlackInput } from "../../connectors";
import { dryRunConnectors } from "../../connectors/default";
import { MemoryStore } from "../../storage/memory/store";
import { slackReplyEventId } from "../../services/slack-events";
import type { NodeRuntime } from "../define";
import { slackPost, slackWaitForReply } from "./actions";

function harness() {
  const store = new MemoryStore();
  const calls: SlackInput[] = [];
  const connectors: Connectors = {
    ...dryRunConnectors(),
    slack: {
      async post(input) {
        calls.push(input);
        return { ok: true, ts: "1680000000.000100", channel: "C123", dryRun: false };
      },
    },
  };
  const rt: NodeRuntime = {
    kv: store.kv,
    credentials: store.credentials,
    connections: store.connections,
    connectors,
    conversations: store.conversations,
    ownerId: "owner-A",
    runId: "r",
    workflowRunId: "wr",
    stepId: "s",
  };
  return { store, rt, calls };
}

test("slack.post via a connection: bot token + blocks + thread_ts, returns ts", async () => {
  const { store, rt, calls } = harness();
  await store.connections.upsert({
    id: "conn1",
    ownerId: "owner-A",
    provider: "slack",
    accountId: "T1",
    label: "Acme",
    scopes: ["chat:write"],
    accessToken: "xoxb-123",
    refreshToken: null,
    expiresAt: null,
  });
  const out = await slackPost.execute!({
    inputs: { channel: "#general", text: "hi", blocks: [{ type: "section" }], threadTs: "999.0001" },
    params: { connectionId: "conn1" },
    rt,
  });
  assert.equal(calls[0]!.botToken, "xoxb-123");
  assert.deepEqual(calls[0]!.blocks, [{ type: "section" }]);
  assert.equal(calls[0]!.threadTs, "999.0001");
  assert.equal(calls[0]!.webhookUrl, undefined);
  assert.equal((out.data as { ts?: string }).ts, "1680000000.000100");
});

test("slack.post via a webhook credential uses webhookUrl (no bot token)", async () => {
  const { store, rt, calls } = harness();
  await store.credentials.put({ id: "cred1", ownerId: "owner-A", type: "slack", secret: { webhookUrl: "https://hooks.slack/x" } });
  const out = await slackPost.execute!({ inputs: { channel: "#c", text: "hi" }, params: { credentialId: "cred1" }, rt });
  assert.equal(calls[0]!.webhookUrl, "https://hooks.slack/x");
  assert.equal(calls[0]!.botToken, undefined);
  assert.equal(out.port, "success");
});

async function seedConn(store: MemoryStore, id = "conn1", ownerId = "owner-A", accountId = "T1") {
  await store.connections.upsert({
    id, ownerId, provider: "slack", accountId, label: "Acme", scopes: [],
    accessToken: "xoxb", refreshToken: null, expiresAt: null,
  });
}

test("slack.waitForReply → reply: team-scoped eventId matches the ingress, returns payload", async () => {
  const { store, rt } = harness();
  await seedConn(store);
  let capturedEventId: string | undefined;
  const rt2: NodeRuntime = {
    ...rt,
    waitForEvent: async (eventId) => {
      capturedEventId = eventId;
      return { timedOut: false, data: { text: "ship it", user: "U1", ts: "2.2" } };
    },
  };
  const out = await slackWaitForReply.execute!({
    inputs: { channel: "C1", threadTs: "1.1", timeoutSec: 60 },
    params: { connectionId: "conn1" },
    rt: rt2,
  });
  assert.equal(out.port, "reply");
  // Same id the /slack/events ingress computes for team T1, channel C1, thread 1.1.
  assert.equal(capturedEventId, slackReplyEventId("T1", "C1", "1.1"));
  assert.equal((out.data as { reply: { text: string } }).reply.text, "ship it");
});

test("slack.waitForReply → timeout when no reply arrives", async () => {
  const { store, rt } = harness();
  await seedConn(store);
  const rt2: NodeRuntime = { ...rt, waitForEvent: async () => ({ timedOut: true, data: null }) };
  const out = await slackWaitForReply.execute!({
    inputs: { channel: "C1", threadTs: "1.1" },
    params: { connectionId: "conn1" },
    rt: rt2,
  });
  assert.equal(out.port, "timeout");
});

test("slack.post cannot use another owner's connection (tenant isolation)", async () => {
  const { store, rt } = harness();
  await store.connections.upsert({
    id: "conn1",
    ownerId: "owner-OTHER",
    provider: "slack",
    accountId: "T9",
    label: "Other",
    scopes: [],
    accessToken: "xoxb-other",
    refreshToken: null,
    expiresAt: null,
  });
  // rt.ownerId is "owner-A" → the owner-OTHER connection is invisible.
  await assert.rejects(
    () => slackPost.execute!({ inputs: { channel: "#c", text: "hi" }, params: { connectionId: "conn1" }, rt }),
    /Connection/,
  );
});
