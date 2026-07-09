import { randomUUID } from "node:crypto";
import type { Connectors, HttpConnector, HttpInput, SlackConnector, SlackInput, SlackResult } from "./index";
import { OpenRouterAiConnector } from "./ai";
import { ResendEmailConnector } from "./email";
import { NodemailerSmtpConnector } from "./smtp";
import { safeFetch } from "./ssrf";

const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";

/**
 * Posts to Slack via the Web API (`chat.postMessage`) when a bot token is
 * supplied — supports Block Kit, threading, and returns the message `ts`
 * (thread id). Falls back to an incoming webhook (no ts/threading). No auth →
 * dry-run.
 */
class DefaultSlackConnector implements SlackConnector {
  async post(input: SlackInput): Promise<SlackResult> {
    if (input.botToken) {
      const res = await fetch(SLACK_POST_MESSAGE_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          channel: input.channel,
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.blocks ? { blocks: input.blocks } : {}),
          ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; ts?: string; channel?: string; error?: string };
      if (!json.ok) throw new Error(`Slack chat.postMessage failed: ${json.error ?? "unknown_error"}`);
      return { ok: true, ts: json.ts, channel: json.channel, dryRun: false };
    }
    if (input.webhookUrl) {
      const res = await fetch(input.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(input.channel ? { channel: input.channel } : {}),
          ...(input.text !== undefined ? { text: input.text } : {}),
          ...(input.blocks ? { blocks: input.blocks } : {}),
        }),
      });
      return { ok: res.ok, dryRun: false };
    }
    return { ok: true, dryRun: true };
  }
}

class FetchHttpConnector implements HttpConnector {
  async request(input: HttpInput): Promise<{ status: number; body: unknown }> {
    // safeFetch validates + pins the IP and re-checks every redirect hop (SSRF).
    const res = await safeFetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // keep raw text
    }
    return { status: res.status, body };
  }
}

export function defaultConnectors(): Connectors {
  return {
    email: new ResendEmailConnector(),
    slack: new DefaultSlackConnector(),
    http: new FetchHttpConnector(),
    smtp: new NodemailerSmtpConnector(),
    ai: new OpenRouterAiConnector(),
  };
}

/** Dry-run connectors for local demos/tests — no network, deterministic-ish. */
export function dryRunConnectors(): Connectors {
  return {
    email: {
      async send() {
        return { id: `dry_${randomUUID()}`, dryRun: true };
      },
    },
    slack: {
      async post() {
        return { ok: true, dryRun: true };
      },
    },
    http: {
      async request() {
        return { status: 200, body: { dryRun: true } };
      },
    },
    smtp: {
      async send() {
        return { messageId: `dry_${randomUUID()}`, dryRun: true };
      },
    },
    ai: {
      async complete(_creds, input) {
        return { text: "[dry-run]", model: input.model, dryRun: true };
      },
      async image(_creds, input) {
        return { images: [], model: input.model, dryRun: true };
      },
      async transcribe(_creds, input) {
        return { text: "[dry-run]", model: input.model, dryRun: true };
      },
      async tts(_creds, input) {
        return { audio: "", format: input.format ?? "mp3", model: input.model, dryRun: true };
      },
      async chat() {
        const message = { role: "assistant", content: "[dry-run]" };
        return { message, content: "[dry-run]", toolCalls: [], dryRun: true };
      },
    },
  };
}
