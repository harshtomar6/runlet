import { Client } from "@upstash/workflow";
import { Hono } from "hono";
import { env } from "../../config/env";
import { ApiError } from "../../errors";
import { parseSlackReply, verifySlackSignature } from "../../services/slack-events";
import type { AppEnv } from "../types";

/**
 * Slack Events API ingress (public — Slack calls it). Verifies the signature,
 * answers the url_verification handshake, and for thread replies resumes any
 * run waiting on `slack.waitForReply` via QStash notify (like POST /approvals).
 * Must ack within 3s, so delivery is a single fast notify.
 */
export const slackEvents = new Hono<AppEnv>();

slackEvents.post("/", async (c) => {
  const raw = await c.req.text();

  if (env.SLACK_SIGNING_SECRET) {
    const okSig = verifySlackSignature(
      raw,
      env.SLACK_SIGNING_SECRET,
      c.req.header("x-slack-signature"),
      c.req.header("x-slack-request-timestamp"),
      Math.floor(Date.now() / 1000),
    );
    if (!okSig) throw new ApiError(401, "invalid_signature", "Invalid Slack signature");
  } else if (env.NODE_ENV === "production") {
    // Fail closed: never accept unsigned Slack events in production.
    throw new ApiError(503, "slack_signing_secret_unset", "SLACK_SIGNING_SECRET must be set to accept Slack events");
  }

  let body: Record<string, unknown> = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError(400, "invalid_json", "Slack event body must be valid JSON");
    }
  }

  // Setup handshake.
  if (body.type === "url_verification") return c.json({ challenge: body.challenge });

  if (body.type === "event_callback") {
    const reply = parseSlackReply(body);
    if (reply) await deliver(reply.eventId, reply.eventData);
  }

  // Always 200 quickly so Slack doesn't retry.
  return c.json({ ok: true });
});

/** Resume the waiting run. qstash mode → QStash notify; local mode → no-op. */
async function deliver(eventId: string, eventData: unknown): Promise<void> {
  if (env.DISPATCH_MODE !== "qstash" || !env.QSTASH_TOKEN) return;
  const client = new Client({ token: env.QSTASH_TOKEN });
  await client.notify({ eventId, eventData });
}
