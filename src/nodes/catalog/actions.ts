import { z } from "zod";
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
    // Idempotent per (run, recipient, template) so retries don't double-send.
    const idem = `email:${rt.workflowRunId}:${to}:${templateId}`;
    if (!(await rt.kv.setNX(idem, "1", 86_400))) {
      return { data: { skipped: true }, port: "success" };
    }
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
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
  description: "Posts a message to a Slack channel.",
  inputSchema: z.object({
    channel: z.string().min(1),
    text: z.string().min(1),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["slack"],
  execute: async ({ inputs, params, rt }) => {
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.slack.post(creds, {
      channel: String(inputs.channel),
      text: String(inputs.text),
    });
    return { data: res, port: "success" };
  },
});

export const httpRequest = defineNode({
  type: "http.request",
  kind: "action",
  category: "HTTP",
  label: "HTTP Request",
  description: "Makes an outbound HTTP request.",
  inputSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().min(1),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
  }),
  outputs: ["success", "error"],
  execute: async ({ inputs, rt }) => {
    const res = await rt.connectors.http.request({
      method: String(inputs.method ?? "GET"),
      url: String(inputs.url),
      headers: inputs.headers as Record<string, string> | undefined,
      body: inputs.body,
    });
    return { data: res, port: "success" };
  },
});

export const actionNodes = [emailSend, slackPost, httpRequest];
