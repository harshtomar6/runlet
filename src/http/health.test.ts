import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app";

test("GET /health is public and reports ok", async () => {
  const res = await createApp().request("/health");
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { status?: string }).status, "ok");
});

test("POST /health/echo reads the request body", async () => {
  const res = await createApp().request("/health/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, method: "POST", bytes: 17 });
});

test("GET /health/db reports the store outcome (memory store)", async () => {
  // Tests run with the in-memory store, so this is deterministic and DB-free.
  const res = await createApp().request("/health/db");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, store: "memory" });
});
