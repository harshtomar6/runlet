import { z } from "zod";
import { defineNode } from "../define";

export const dataSet = defineNode({
  type: "data.set",
  kind: "action",
  category: "Data",
  label: "Set Fields",
  description: "Builds an object from static values and expressions.",
  inputSchema: z.object({
    fields: z.record(z.unknown()),
  }),
  outputs: ["out"],
  execute: async ({ inputs }) => {
    return { data: (inputs.fields ?? {}) as Record<string, unknown>, port: "out" };
  },
});

export const dataTransform = defineNode({
  type: "data.transform",
  app: "data",
  kind: "action",
  category: "Data",
  label: "Transform",
  description: "Outputs a value computed from an expression (e.g. reshape upstream data).",
  inputSchema: z.object({
    value: z.unknown(), // usually a {{ expression }} or object of expressions
  }),
  outputs: ["out"],
  execute: async ({ inputs }) => {
    return { data: inputs.value ?? null, port: "out" };
  },
});

export const dataNodes = [dataSet, dataTransform];
