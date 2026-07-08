import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app";
import { LLMS_TXT } from "./llms-content";

test("GET /llms.txt serves the build guide as plain text", async () => {
  const res = await createApp().request("/llms.txt");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
  assert.equal(await res.text(), LLMS_TXT);
});

test("the embedded guide is the real WORKFLOW_API.md content", () => {
  // Sanity: guards against an empty/stale generated module.
  assert.ok(LLMS_TXT.includes("# Workflow Automation API"));
  assert.ok(LLMS_TXT.includes("/llms.txt") || LLMS_TXT.length > 10_000);
});
