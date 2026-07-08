import { z } from "zod";
import { defineNode } from "../define";

export const triggerEvent = defineNode({
  type: "trigger.event",
  kind: "trigger",
  category: "Triggers",
  label: "On Event",
  description: "Starts the workflow when a matching app event is received.",
  inputSchema: z.object({
    eventType: z.string().min(1),
  }),
  outputs: ["out"],
});

export const triggerWebhook = defineNode({
  type: "trigger.webhook",
  kind: "trigger",
  category: "Triggers",
  label: "On Webhook",
  description: "Starts the workflow from an inbound HTTP request.",
  inputSchema: z.object({}),
  outputs: ["out"],
});

export const triggerSchedule = defineNode({
  type: "trigger.schedule",
  kind: "trigger",
  category: "Triggers",
  label: "On Schedule",
  description: "Starts the workflow on a cron schedule.",
  inputSchema: z.object({
    cron: z.string().min(1),
  }),
  outputs: ["out"],
});

export const triggerManual = defineNode({
  type: "trigger.manual",
  kind: "trigger",
  category: "Triggers",
  label: "Manual",
  description: "Started on demand via the API.",
  inputSchema: z.object({}),
  outputs: ["out"],
});

export const triggerNodes = [triggerEvent, triggerWebhook, triggerSchedule, triggerManual];
