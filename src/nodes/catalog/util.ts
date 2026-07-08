import { z } from "zod";
import { log } from "../../observability/logger";
import { defineNode } from "../define";

export const logNode = defineNode({
  type: "util.log",
  app: "util",
  kind: "action",
  category: "Utility",
  label: "Log",
  description: "Writes a message to the run log (debugging); passes input through.",
  inputSchema: z.object({
    message: z.string(),
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    const level = (inputs.level as "debug" | "info" | "warn" | "error") ?? "info";
    const message = String(inputs.message);
    log[level]("util.log", { runId: rt.runId, stepId: rt.stepId, message });
    return { data: { message }, port: "out" };
  },
});

export const utilNodes = [logNode];
