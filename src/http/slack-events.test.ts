import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { parseSlackReply, slackReplyEventId, verifySlackSignature } from "../services/slack-events";
import { createApp } from "./app";

test("parseSlackReply extracts a thread reply, ignores noise", () => {
  const reply = parseSlackReply({
    team_id: "T1",
    event: { type: "message", channel: "C1", ts: "2.2", thread_ts: "1.1", text: "hi", user: "U1" },
  });
  assert.equal(reply?.eventId, slackReplyEventId("T1", "C1", "1.1"));
  assert.equal(reply?.eventData.text, "hi");

  // bot echo, parent (not a reply), and non-message events are ignored.
  assert.equal(parseSlackReply({ team_id: "T1", event: { type: "message", channel: "C1", ts: "2.2", thread_ts: "1.1", bot_id: "B1" } }), null);
  assert.equal(parseSlackReply({ team_id: "T1", event: { type: "message", channel: "C1", ts: "1.1", thread_ts: "1.1" } }), null);
  assert.equal(parseSlackReply({ team_id: "T1", event: { type: "reaction_added" } }), null);
});

test("verifySlackSignature accepts valid, rejects tampered/stale/missing", () => {
  const secret = "shhh";
  const ts = "1700000000";
  const body = '{"a":1}';
  const sig = `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;
  const now = 1_700_000_000;
  assert.equal(verifySlackSignature(body, secret, sig, ts, now), true);
  assert.equal(verifySlackSignature(`${body}x`, secret, sig, ts, now), false); // tampered body
  assert.equal(verifySlackSignature(body, secret, sig, ts, now + 4000), false); // stale (>300s)
  assert.equal(verifySlackSignature(body, secret, undefined, ts, now), false); // missing sig
});

test("POST /slack/events answers the url_verification handshake", async () => {
  const res = await createApp().request("/slack/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "abc123" }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { challenge: "abc123" });
});
