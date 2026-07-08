import assert from "node:assert/strict";
import { test } from "node:test";
import { byteaFromDriver } from "./schema";

// The credential ciphertext column must round-trip identically across drivers:
// postgres.js returns a Buffer, the Neon HTTP driver returns a "\x..." hex string.
test("byteaFromDriver normalises every driver shape to the same Buffer", () => {
  const original = Buffer.from([0x0a, 0x1b, 0xff, 0x00, 0x7e]);
  const hex = original.toString("hex");

  assert.deepEqual(byteaFromDriver(original), original); // postgres.js (Buffer)
  assert.deepEqual(byteaFromDriver(`\\x${hex}`), original); // Neon HTTP (\x-prefixed hex)
  assert.deepEqual(byteaFromDriver(hex), original); // bare hex (defensive)
  assert.deepEqual(byteaFromDriver(new Uint8Array(original)), original); // Uint8Array
});
