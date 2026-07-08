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
    // Keyed by the durable stepId so retries of the SAME step dedup, but each
    // loop iteration (distinct stepId) sends — not skipped as a false duplicate.
    const idem = `email:${rt.stepId}:${to}:${templateId}`;
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
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId)) : null;
    const res = await rt.connectors.smtp.send(creds, {
      to,
      subject: String(inputs.subject),
      html: inputs.html as string | undefined,
      text: inputs.text as string | undefined,
    });
    return { data: res, port: "success" };
  },
});

export const actionNodes = [emailSend, smtpSend, slackPost, httpRequest];
