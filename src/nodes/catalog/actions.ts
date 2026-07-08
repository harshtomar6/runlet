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
  }),
  outputs: ["success", "error"],
  credentials: ["resend"],
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
  }),
  outputs: ["success", "error"],
  credentials: ["slack"],
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
});

export const actionNodes = [emailSend, slackPost, httpRequest];
