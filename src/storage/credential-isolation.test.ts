import assert from "node:assert/strict";
import { test } from "node:test";
import { NotFoundError } from "../ports/errors";
import { MemoryStore } from "./memory/store";

// Tenant isolation: credentials.get is owner-scoped, so a workflow run can only
// decrypt secrets owned by the run's owner — even if another tenant's
// credentialId is referenced in a node's params (the IDOR this closes).
test("credentials.get is owner-scoped", async () => {
  const store = new MemoryStore();
  await store.credentials.put({ id: "cred1", ownerId: "owner-A", type: "slack", secret: { botToken: "xoxb-A" } });

  // Owner A can read their own credential.
  const mine = await store.credentials.get("cred1", "owner-A");
  assert.deepEqual(mine.secret, { botToken: "xoxb-A" });

  // Owner B cannot — even knowing the exact id — and it's indistinguishable
  // from "does not exist" (no existence leak).
  await assert.rejects(() => store.credentials.get("cred1", "owner-B"), NotFoundError);
});

test("list exposes secret field NAMES (not values) for discoverability", async () => {
  const store = new MemoryStore();
  await store.credentials.put({ id: "c1", ownerId: "o", type: "telegram", secret: { botToken: "123:ABC", chatId: "42" } });
  const [meta] = await store.credentials.list("o");
  assert.deepEqual(meta!.secretKeys.sort(), ["botToken", "chatId"]);
  // ...but never the values.
  assert.ok(!JSON.stringify(meta).includes("123:ABC"));
});
