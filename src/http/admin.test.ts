import assert from "node:assert/strict";
import { test } from "node:test";

// ADMIN_SECRET must be set before config/env is first imported.
process.env.ADMIN_SECRET = "s3cr3t";
const { createApp } = await import("./app");

test("POST /admin/tenants mints a key for a new owner; the key then authenticates as it", async () => {
  const app = createApp();
  const res = await app.request("/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": "s3cr3t" },
    body: JSON.stringify({ ownerId: "org_42", name: "bff" }),
  });
  assert.equal(res.status, 201);
  const data = ((await res.json()) as { data: { ownerId: string; key: string } }).data;
  assert.equal(data.ownerId, "org_42");
  assert.ok(data.key.startsWith("ak_"));

  // The minted key authenticates as org_42 (owner-scoped: empty workflow list).
  const authed = await app.request("/workflows", { headers: { authorization: `Bearer ${data.key}` } });
  assert.equal(authed.status, 200);
});

test("POST /admin/tenants rejects a missing/wrong admin secret", async () => {
  const app = createApp();
  const noSecret = await app.request("/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ownerId: "org_x" }),
  });
  assert.equal(noSecret.status, 401);

  const wrong = await app.request("/admin/tenants", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-secret": "nope" },
    body: JSON.stringify({ ownerId: "org_x" }),
  });
  assert.equal(wrong.status, 401);
});
