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

test("non-terminating recursion is stopped (not left running until the heap is exhausted)", async () => {
  // The dry-run OOM shape: a recursive helper whose base case never matches undefined.
  const expr = "{{ ( $pairs := function($s) { $length($s) <= 2 ? $s : $pairs($s) & ',' }; $pairs(trigger.missing) ) }}";
  const started = Date.now();
  await assert.rejects(resolveValue(expr, { trigger: {} }), /D1011: Stack overflow/);
  assert.ok(Date.now() - started < 1000, "fails fast");
  const heapAfter = process.memoryUsage().heapUsed;
  await new Promise((r) => setTimeout(r, 200)); // nothing keeps evaluating in the background
  assert.ok(process.memoryUsage().heapUsed - heapAfter < 50e6);
});

test("huge sequences are capped; bounded recursion still works", async () => {
  await assert.rejects(resolveValue("{{ $count([1..100000000]) }}", {}), /Expression failed/);
  const fact = "{{ ( $f := function($n) { $n <= 1 ? 1 : $n * $f($n - 1) }; $f(10) ) }}";
  assert.equal(await resolveValue(fact, {}), 3628800);
});
