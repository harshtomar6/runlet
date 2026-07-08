import { z } from "zod";
import { sendAlert } from "../../observability/alert";
import { defineNode } from "../define";

export const wait = defineNode({
  type: "control.wait",
  kind: "wait",
  category: "Control",
  label: "Wait",
  description: "Pauses the workflow for a duration (e.g. 30s, 2h, 1d).",
  inputSchema: z.object({
    duration: z.string().min(1),
  }),
  outputs: ["out"],
});

export const ifNode = defineNode({
  type: "control.if",
  kind: "control",
  category: "Control",
  label: "If",
  description: "Branches on a boolean condition.",
  inputSchema: z.object({
    // An expression (string) at config time that resolves to any truthy/falsy
    // value at runtime — so the resolved input is validated as unknown.
    condition: z.unknown(),
  }),
  outputs: ["true", "false"],
  execute: async ({ inputs }) => {
    const truthy = Boolean(inputs.condition);
    return { data: { condition: truthy }, port: truthy ? "true" : "false" };
  },
});

export const loop = defineNode({
  type: "control.loop",
  kind: "control",
  category: "Control",
  label: "Loop",
  description: "Repeats the connected branch a fixed number of times.",
  inputSchema: z.object({
    times: z.number().int().positive().max(1000),
  }),
  outputs: ["each", "done"],
});

export const switchNode = defineNode({
  type: "control.switch",
  app: "control",
  kind: "control",
  category: "Control",
  label: "Switch",
  description: "Routes to the numbered port of the first matching case, else `default`.",
  inputSchema: z.object({
    value: z.unknown(),
    // First case whose `equals` matches `value` → port "0".."4"; else "default".
    cases: z.array(z.object({ equals: z.unknown() })).max(5).default([]),
  }),
  outputs: ["0", "1", "2", "3", "4", "default"],
  execute: async ({ inputs }) => {
    const value = inputs.value;
    const cases = (inputs.cases ?? []) as Array<{ equals: unknown }>;
    const idx = cases.findIndex((c) => c.equals === value);
    const port = idx >= 0 && idx <= 4 ? String(idx) : "default";
    return { data: { value, matched: port }, port };
  },
});

export const filterNode = defineNode({
  type: "control.filter",
  app: "control",
  kind: "control",
  category: "Control",
  label: "Filter",
  description: "Continues on `out` when the condition is truthy; otherwise halts this branch.",
  inputSchema: z.object({
    condition: z.unknown(),
  }),
  outputs: ["out", "stop"],
  execute: async ({ inputs }) => {
    const pass = Boolean(inputs.condition);
    return { data: { pass }, port: pass ? "out" : "stop" };
  },
});

export const approvalNode = defineNode({
  type: "control.approval",
  app: "control",
  kind: "control",
  category: "Control",
  label: "Human Approval",
  description:
    "Pauses until a human approves/rejects (POST /approvals) or the timeout elapses. Routes to `approved` / `rejected`. Durable in qstash mode; auto-approves in local mode.",
  inputSchema: z.object({
    message: z.string().optional(),
    timeoutSec: z.number().int().positive().max(2_592_000).default(86_400), // ≤30d, default 1d
  }),
  outputs: ["approved", "rejected"],
  durable: true,
  execute: async ({ inputs, rt }) => {
    const eventId = `approval:${rt.runId}:${rt.stepId}`;
    const timeoutSec = (inputs.timeoutSec as number | undefined) ?? 86_400;

    // Announce so a human/UI can act (POST /approvals with this eventId).
    await sendAlert("Approval requested", {
      eventId,
      runId: rt.runId,
      message: (inputs.message as string | undefined) ?? "",
    });

    const wait =
      rt.waitForEvent ?? (async () => ({ timedOut: false, data: { approved: true, auto: true } }));
    const res = await wait(eventId, timeoutSec);

    const approved = !res.timedOut && (res.data as { approved?: boolean } | null)?.approved !== false;
    return {
      data: { eventId, approved, timedOut: res.timedOut, decision: res.data ?? null },
      port: approved ? "approved" : "rejected",
    };
  },
});

export const controlNodes = [wait, ifNode, loop, switchNode, filterNode, approvalNode];
