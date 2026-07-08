import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../../connectors/default";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore, KVState } from "../../ports";
import { MemoryConversationStore } from "../../storage/memory/conversation-store";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeExecArgs, NodeRuntime } from "../define";
import { stateDelete, stateGet, stateIncr, stateSet, stateSetNX } from "./state";

const nullCreds: CredentialStore = {
  async get(): Promise<DecryptedSecret> { throw new Error("no creds"); },
  async put() {}, async list() { return []; }, async delete() { return false; },
};

// One shared KV across calls, so cross-execution state actually persists.
function ctx(kv: KVState, ownerId = "o") {
  const rt: NodeRuntime = {
    kv, credentials: nullCreds, connectors: dryRunConnectors(),
    conversations: new MemoryConversationStore(), ownerId,
    runId: "r", workflowRunId: "wr", stepId: "s",
  };
  return (inputs: Record<string, unknown>): NodeExecArgs => ({ inputs, params: inputs, rt });
}

test("state.set / state.get round-trip (JSON)", async () => {
  const kv = new MemoryKVState();
  const a = ctx(kv);
  await stateSet.execute!(a({ key: "k", value: { n: 1, s: "x" } }));
  const got = await stateGet.execute!(a({ key: "k" }));
  assert.deepEqual((got.data as { value: unknown }).value, { n: 1, s: "x" });
  const missing = await stateGet.execute!(a({ key: "nope" }));
  assert.equal((missing.data as { value: unknown }).value, null);
});

test("state.setNX dedups: first sets, second doesn't", async () => {
  const kv = new MemoryKVState();
  const a = ctx(kv);
  const first = await stateSetNX.execute!(a({ key: "alert:svc", value: "1", ttlSec: 3600 }));
  const second = await stateSetNX.execute!(a({ key: "alert:svc", value: "1", ttlSec: 3600 }));
  assert.equal((first.data as { set: boolean }).set, true);
  assert.equal((second.data as { set: boolean }).set, false);
  // delete resets it → next setNX sets again (recovery → re-alert)
  await stateDelete.execute!(a({ key: "alert:svc" }));
  const third = await stateSetNX.execute!(a({ key: "alert:svc", ttlSec: 3600 }));
  assert.equal((third.data as { set: boolean }).set, true);
});

test("state.incr counts", async () => {
  const kv = new MemoryKVState();
  const a = ctx(kv);
  assert.equal(((await stateIncr.execute!(a({ key: "c" }))).data as { value: number }).value, 1);
  assert.equal(((await stateIncr.execute!(a({ key: "c" }))).data as { value: number }).value, 2);
});

test("keys are owner-scoped (no cross-tenant collision)", async () => {
  const kv = new MemoryKVState();
  const o1 = ctx(kv, "owner-1");
  const o2 = ctx(kv, "owner-2");
  assert.equal(((await stateSetNX.execute!(o1({ key: "alert:x", ttlSec: 60 }))).data as { set: boolean }).set, true);
  // same key, different owner → independent → also sets
  assert.equal(((await stateSetNX.execute!(o2({ key: "alert:x", ttlSec: 60 }))).data as { set: boolean }).set, true);
});
