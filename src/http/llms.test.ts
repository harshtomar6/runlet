import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app";
import { LLMS_TXT } from "./llms-content";

test("GET /llms.txt serves the build guide as plain text", async () => {
  const res = await createApp().request("/llms.txt");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  assert.ok((await res.text()).includes(LLMS_TXT));
});

test("GET /llms.txt injects the deployment base URL from forwarded headers", async () => {
  const res = await createApp().request("/llms.txt", {
    headers: { "x-forwarded-proto": "https", "x-forwarded-host": "api.example.com" },
  });
  const body = await res.text();
  assert.ok(body.startsWith("> **Base URL for this deployment:** https://api.example.com"));
  assert.ok(body.includes("POST https://api.example.com/workflows"));
});

test("the embedded guide is the real WORKFLOW_API.md content", () => {
  // Sanity: guards against an empty/stale generated module.
  assert.ok(LLMS_TXT.includes("# Workflow Automation API"));
  assert.ok(LLMS_TXT.length > 10_000);
});
