import { randomUUID } from "node:crypto";
import type { Connectors, HttpConnector, HttpInput, SlackConnector, SlackInput } from "./index";
import { ResendEmailConnector } from "./email";
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
  };
}
