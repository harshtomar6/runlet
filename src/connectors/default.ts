import { randomUUID } from "node:crypto";
import type { Connectors, HttpConnector, HttpInput, SlackConnector, SlackInput } from "./index";
import { OpenRouterAiConnector } from "./ai";
import { ResendEmailConnector } from "./email";
import { NodemailerSmtpConnector } from "./smtp";
import { safeFetch } from "./ssrf";
import type { DecryptedSecret } from "../domain/types";

class WebhookSlackConnector implements SlackConnector {
  async post(creds: DecryptedSecret | null, input: SlackInput): Promise<{ ok: boolean; dryRun: boolean }> {
    const webhook = creds?.secret?.webhookUrl as string | undefined;
    if (!webhook) return { ok: true, dryRun: true };
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: input.channel, text: input.text }),
    });
    return { ok: res.ok, dryRun: false };
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
    slack: new WebhookSlackConnector(),
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
