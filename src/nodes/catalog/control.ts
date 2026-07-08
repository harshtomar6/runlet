import { z } from "zod";
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

export const controlNodes = [wait, ifNode, loop];
