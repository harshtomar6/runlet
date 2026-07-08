import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "../storage/memory/store";
import { ApiKeyService } from "./api-key-service";

test("issued key verifies to its owner; revoked key is rejected", async () => {
  const store = new MemoryStore();
  const svc = new ApiKeyService(store);

  const issued = await svc.issue("acme", "server");
  assert.ok(issued.key.startsWith("ak_"));
  assert.ok(issued.prefix.length <= 11);

  assert.deepEqual(await svc.verify(issued.key), { ownerId: "acme" });
  assert.equal(await svc.verify("ak_wrong"), null);

  // list returns metadata only (no hash / no plaintext)
  const list = await svc.list("acme");
  assert.equal(list.length, 1);
  assert.equal((list[0] as unknown as Record<string, unknown>).keyHash, undefined);

  await svc.revoke("acme", issued.id);
  assert.equal(await svc.verify(issued.key), null);
});

test("keys are owner-scoped for revoke", async () => {
  const store = new MemoryStore();
  const svc = new ApiKeyService(store);
  const issued = await svc.issue("acme", "k");
  await svc.revoke("other", issued.id); // wrong owner → no-op
  assert.deepEqual(await svc.verify(issued.key), { ownerId: "acme" });
});
