import assert from "node:assert/strict";
import { test } from "node:test";

// AUTH_DEV_OWNER lets the authed routes resolve an owner without a key.
process.env.AUTH_DEV_OWNER = "dev";
const { createApp } = await import("./app");

const CUSTOM = {
  type: "custom.telegram.send",
  label: "Telegram Send",
  app: "telegram",
  category: "Telegram",
  fields: [{ name: "chatId", type: "string", required: true }],
  request: {
    method: "POST",
    url: "https://api.telegram.org/bot{{ $secret.botToken }}/sendMessage",
    body: { chat_id: "{{ chatId }}", text: "{{ text }}" },
  },
};

test("POST /node-defs creates a custom node; it appears in /node-types", async () => {
  const app = createApp();
  const created = await app.request("/node-defs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(CUSTOM),
  });
  assert.equal(created.status, 201);
  const def = ((await created.json()) as { data: { type: string; id: string } }).data;
  assert.equal(def.type, "custom.telegram.send");
  assert.ok(def.id);

  // Discoverable in the catalog (authed request merges owner customs).
  const catalog = await app.request("/node-types", { headers: { authorization: "Bearer x" } });
  const types = ((await catalog.json()) as { data: { type: string }[] }).data.map((n) => n.type);
  assert.ok(types.includes("custom.telegram.send"));

  // And listed via /node-defs.
  const list = await app.request("/node-defs");
  assert.ok(((await list.json()) as { data: unknown[] }).data.length >= 1);
});

test("POST /node-defs rejects a non-custom type and a built-in collision", async () => {
  const app = createApp();
  const bad = await app.request("/node-defs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...CUSTOM, type: "slack.post" }), // not under custom.
  });
  assert.equal(bad.status, 400); // regex validation
});

test("POST /node-defs rejects a malformed expression in the request template", async () => {
  const app = createApp();
  const bad = await app.request("/node-defs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...CUSTOM, type: "custom.bad.one", request: { method: "GET", url: "https://x/{{ foo.. }}" } }),
  });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { error: { code: string } }).error.code, "invalid_expression");
});
