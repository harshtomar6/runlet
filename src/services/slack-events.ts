import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Shared Slack Events glue so the ingress (POST /slack/events) and the
 * `slack.waitForReply` node compute the SAME event id for a given thread.
 * Namespaced by team so replies can't cross workspaces.
 */
export function slackReplyEventId(teamId: string, channel: string, threadTs: string): string {
  return `slack:reply:${teamId}:${channel}:${threadTs}`;
}

export interface SlackReply {
  eventId: string;
  eventData: { text: string; user: string; ts: string; channel: string; teamId: string };
}

/**
 * Extract a thread-reply from a Slack `event_callback` body, or null if it isn't
 * one we care about. Ignores non-messages, message subtypes (edits/joins/etc.),
 * the bot's own messages (`bot_id`), and top-level (non-threaded) messages.
 */
export function parseSlackReply(body: unknown): SlackReply | null {
  const b = body as { team_id?: string; event?: Record<string, unknown> } | null;
  const ev = b?.event;
  if (!ev || ev.type !== "message") return null;
  if (ev.bot_id || ev.subtype) return null; // bot echo / non-user message
  const threadTs = ev.thread_ts as string | undefined;
  const ts = ev.ts as string | undefined;
  if (!threadTs || threadTs === ts) return null; // not a reply
  const teamId = b?.team_id ?? "";
  const channel = (ev.channel as string | undefined) ?? "";
  if (!teamId || !channel) return null;
  return {
    eventId: slackReplyEventId(teamId, channel, threadTs),
    eventData: {
      text: (ev.text as string | undefined) ?? "",
      user: (ev.user as string | undefined) ?? "",
      ts: ts ?? "",
      channel,
      teamId,
    },
  };
}

/** Verify Slack's `X-Slack-Signature` over `v0:<ts>:<rawBody>` (5-min replay window). */
export function verifySlackSignature(
  rawBody: string,
  signingSecret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  nowSec: number,
): boolean {
  if (!signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false; // stale / replay
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
