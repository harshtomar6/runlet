import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSecretRefs, resolveValue } from "./expr";

test("the general pass resolves normal expressions but preserves {{ $secret.* }}", async () => {
  const out = await resolveValue("https://api.telegram.org/bot{{ $secret.botToken }}/x?c={{ trigger.chat }}", {
    trigger: { chat: 42 },
  });
  // $secret preserved verbatim (stays out of scope/logs); trigger resolved.
  assert.equal(out, "https://api.telegram.org/bot{{ $secret.botToken }}/x?c=42");
});

test("resolveSecretRefs binds $secret and substitutes late", async () => {
  const url = await resolveSecretRefs("https://api.telegram.org/bot{{ $secret.botToken }}/sendMessage", {
    botToken: "123:ABC",
  });
  assert.equal(url, "https://api.telegram.org/bot123:ABC/sendMessage");

  // deep (headers/body objects) + non-secret strings untouched
  const obj = await resolveSecretRefs({ h: { "X-Token": "{{ $secret.k }}" }, plain: "literal" }, { k: "SEC" });
  assert.deepEqual(obj, { h: { "X-Token": "SEC" }, plain: "literal" });
});
