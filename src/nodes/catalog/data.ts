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
});

export const dataNodes = [dataSet];
