import { z } from "zod";
import { resolveSecretRefs } from "../../engine/expr";
import { slackReplyEventId } from "../../services/slack-events";
import { defineNode } from "../define";

export const emailSend = defineNode({
  type: "email.send",
  kind: "action",
  category: "Email",
  label: "Send Email",
  description: "Sends a templated email via the configured provider.",
  inputSchema: z.object({
    to: z.string().min(1),
    templateId: z.string().min(1),
    vars: z.record(z.unknown()).optional(),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["resend"],
  execute: async ({ inputs, params, rt }) => {
    const to = String(inputs.to);
    const templateId = String(inputs.templateId);
    // Keyed by the durable stepId so retries of the SAME step dedup, but each
    // loop iteration (distinct stepId) sends — not skipped as a false duplicate.
    const idem = `email:${rt.stepId}:${to}:${templateId}`;
    if (!(await rt.kv.setNX(idem, "1", 86_400))) {
      return { data: { skipped: true }, port: "success" };
    }
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId), rt.ownerId) : null;
    const res = await rt.connectors.email.send(creds, {
      to,
      templateId,
      vars: inputs.vars as Record<string, unknown> | undefined,
    });
    return { data: res, port: "success" };
  },
});

export const slackPost = defineNode({
  type: "slack.post",
  kind: "action",
  category: "Slack",
  label: "Post to Slack",
  description:
    "Posts a message to a Slack channel. Supports Block Kit (`blocks`) and threading (`threadTs`). " +
    "Prefer `connectionId` (an OAuth Slack connection → Web API, returns `ts`); `credentialId` uses an " +
    "incoming-webhook credential (no `ts`/threading).",
  inputSchema: z.object({
    channel: z.string().min(1),
    text: z.string().optional(),
    blocks: z.array(z.unknown()).optional(), // Block Kit blocks
    threadTs: z.string().optional(), // reply in a thread (use an upstream post's `ts`)
    connectionId: z.string().optional(), // OAuth Slack connection (bot token) — preferred
    credentialId: z.string().optional(), // incoming-webhook credential (fallback)
  }),
  outputs: ["success", "error"],
  credentials: ["slack"],
  execute: async ({ inputs, params, rt }) => {
    let botToken: string | undefined;
    let webhookUrl: string | undefined;
    if (params.connectionId) {
      if (!rt.connections) throw new Error("slack.post: connections are unavailable in this runtime");
      const conn = await rt.connections.get(String(params.connectionId), rt.ownerId);
      botToken = conn.accessToken;
    } else if (params.credentialId) {
      const creds = await rt.credentials.get(String(params.credentialId), rt.ownerId);
      webhookUrl = creds.secret.webhookUrl as string | undefined;
    }
    const res = await rt.connectors.slack.post({
      channel: String(inputs.channel),
      text: inputs.text as string | undefined,
      blocks: inputs.blocks as unknown[] | undefined,
      threadTs: inputs.threadTs as string | undefined,
      botToken,
      webhookUrl,
    });
    return { data: res, port: "success" };
  },
});

export const httpRequest = defineNode({
  type: "http.request",
  kind: "action",
  category: "HTTP",
  label: "HTTP Request",
  description:
    "Makes an outbound HTTP request. By default a non-2xx status is returned as a normal " +
    "success ({ status, body }) — branch on {{ node.status }} to handle it. Set `failOnError: true` " +
    "to make a 4xx/5xx fail the node instead. Auth can be injected from an encrypted credential " +
    "(`credentialId`, secret `{ bearerToken }` or `{ headers }`) or an OAuth connection " +
    "(`connectionId` → `Authorization: Bearer <token>`) — so tokens never live in the workflow JSON.",
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    failOnError: z.boolean().default(false), // true → throw on non-2xx status
    credentialId: z.string().optional(), // inject auth from an encrypted credential
    connectionId: z.string().optional(), // inject Bearer from an OAuth connection
  }),
  outputs: ["success", "error"],
  credentials: ["http"],
  execute: async ({ inputs, params, rt }) => {
    // Auth injection: injected headers win over inline ones (so a stored token
    // overrides any placeholder). Tokens stay out of the workflow definition.
    const injected: Record<string, string> = {};
    let secretScope: Record<string, unknown> = {};
    if (params.connectionId) {
      if (!rt.connections) throw new Error("http.request: connections are unavailable in this runtime");
      const conn = await rt.connections.get(String(params.connectionId), rt.ownerId);
      injected.authorization = `Bearer ${conn.accessToken}`;
      secretScope = { accessToken: conn.accessToken, accountId: conn.accountId, ...conn.raw };
    } else if (params.credentialId) {
      const creds = await rt.credentials.get(String(params.credentialId), rt.ownerId);
      const s = creds.secret as { bearerToken?: unknown; headers?: unknown };
      if (typeof s.bearerToken === "string") injected.authorization = `Bearer ${s.bearerToken}`;
      if (s.headers && typeof s.headers === "object") {
        Object.assign(injected, s.headers as Record<string, string>);
      }
      secretScope = creds.secret;
    }

    // Late secret templating: resolve {{ $secret.* }} in url/headers/body against
    // the credential (e.g. Telegram's token-in-URL). Done here, after node.started
    // is logged with the raw params, so the secret value never hits the event log.
    const url = String(await resolveSecretRefs(inputs.url, secretScope));
    const headers = {
      ...((await resolveSecretRefs(inputs.headers ?? {}, secretScope)) as Record<string, string>),
      ...injected,
    };
    const body = await resolveSecretRefs(inputs.body, secretScope);

    const res = await rt.connectors.http.request({
      method: String(inputs.method ?? "GET"),
      url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
    });
    const ok = res.status >= 200 && res.status < 300;
    if (inputs.failOnError && !ok) {
      const snippet = typeof res.body === "string" ? res.body : JSON.stringify(res.body);
      throw new Error(
        `HTTP ${res.status} for ${String(inputs.method ?? "GET")} ${String(inputs.url)}` +
          (snippet ? `: ${snippet.slice(0, 200)}` : ""),
      );
    }
    return { data: res, port: "success" };
  },
});

export const smtpSend = defineNode({
  type: "email.smtp",
  app: "email",
  kind: "action",
  category: "Email",
  label: "Send Email (SMTP)",
  description: "Sends an email over SMTP (nodemailer). Requires an `smtp` credential.",
  inputSchema: z.object({
    to: z.string().min(1),
    subject: z.string().min(1),
    html: z.string().optional(),
    text: z.string().optional(),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["smtp"],
  execute: async ({ inputs, params, rt }) => {
    const to = String(inputs.to);
    const idem = `smtp:${rt.stepId}:${to}`;
    if (!(await rt.kv.setNX(idem, "1", 86_400))) {
      return { data: { skipped: true }, port: "success" };
    }
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId), rt.ownerId) : null;
    const res = await rt.connectors.smtp.send(creds, {
      to,
      subject: String(inputs.subject),
      html: inputs.html as string | undefined,
      text: inputs.text as string | undefined,
    });
    return { data: res, port: "success" };
  },
});

export const slackWaitForReply = defineNode({
  type: "slack.waitForReply",
  app: "slack",
  kind: "control",
  category: "Slack",
  label: "Wait for Slack Reply",
  description:
    "Pauses until someone replies in a Slack thread, then routes to `reply` with { text, user, ts }; `timeout` if none. " +
    "Pass an upstream slack.post's `{{ node.channel }}` and `{{ node.ts }}`. Needs the same `connectionId` (for the " +
    "workspace) and the Slack Events API pointed at /slack/events. Durable; requires qstash mode (auto-resolves in local).",
  inputSchema: z.object({
    channel: z.string().min(1), // channel id — use {{ post.channel }}
    threadTs: z.string().min(1), // parent message ts — use {{ post.ts }}
    connectionId: z.string().min(1), // Slack connection → workspace (team) id for the event key
    timeoutSec: z.number().int().positive().max(2_592_000).default(86_400),
  }),
  outputs: ["reply", "timeout"],
  durable: true,
  execute: async ({ inputs, params, rt }) => {
    if (!rt.connections) throw new Error("slack.waitForReply: connections are unavailable in this runtime");
    const conn = await rt.connections.get(String(params.connectionId ?? inputs.connectionId), rt.ownerId);
    const eventId = slackReplyEventId(conn.accountId, String(inputs.channel), String(inputs.threadTs));
    const timeoutSec = (inputs.timeoutSec as number | undefined) ?? 86_400;

    // Local mode has no inbound events → auto-resolve so the flow can be tested.
    const wait = rt.waitForEvent ?? (async () => ({ timedOut: false, data: { auto: true } }));
    const res = await wait(eventId, timeoutSec);
    if (res.timedOut) return { data: { eventId, timedOut: true }, port: "timeout" };
    return { data: { eventId, reply: res.data ?? null }, port: "reply" };
  },
});

export const actionNodes = [emailSend, smtpSend, slackPost, slackWaitForReply, httpRequest];
