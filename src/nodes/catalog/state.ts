import { z } from "zod";
import { defineNode } from "../define";

// All keys are owner-scoped so tenants can't collide on shared state.
const scope = (ownerId: string, key: unknown) => `${ownerId}:${String(key)}`;

export const stateGet = defineNode({
  type: "state.get",
  app: "state",
  kind: "action",
  category: "State",
  label: "State Get",
  description: "Read a value shared across executions (JSON-parsed, or null).",
  inputSchema: z.object({ key: z.string().min(1) }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    const raw = await rt.kv.get(scope(rt.ownerId, inputs.key));
    let value: unknown = null;
    if (raw != null) {
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }
    }
    return { data: { key: inputs.key, value }, port: "out" };
  },
});

export const stateSet = defineNode({
  type: "state.set",
  app: "state",
  kind: "action",
  category: "State",
  label: "State Set",
  description: "Write a value shared across executions (optional TTL in seconds).",
  inputSchema: z.object({
    key: z.string().min(1),
    value: z.unknown(),
    ttlSec: z.number().int().positive().optional(),
  }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    await rt.kv.set(scope(rt.ownerId, inputs.key), JSON.stringify(inputs.value ?? null), inputs.ttlSec as number | undefined);
    return { data: { key: inputs.key, ok: true }, port: "out" };
  },
});

export const stateSetNX = defineNode({
  type: "state.setNX",
  app: "state",
  kind: "action",
  category: "State",
  label: "State Set-If-Absent",
  description: "Set only if the key doesn't exist → { set }. Use for 'do this once' / dedup.",
  inputSchema: z.object({
    key: z.string().min(1),
    value: z.string().default("1"),
    ttlSec: z.number().int().positive().default(86_400),
  }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    const set = await rt.kv.setNX(
      scope(rt.ownerId, inputs.key),
      String(inputs.value ?? "1"),
      (inputs.ttlSec as number | undefined) ?? 86_400,
    );
    return { data: { key: inputs.key, set }, port: "out" };
  },
});

export const stateIncr = defineNode({
  type: "state.incr",
  app: "state",
  kind: "action",
  category: "State",
  label: "State Increment",
  description: "Atomically increment a counter → { value } (optional TTL on first incr).",
  inputSchema: z.object({ key: z.string().min(1), ttlSec: z.number().int().positive().optional() }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    const value = await rt.kv.incr(scope(rt.ownerId, inputs.key), inputs.ttlSec as number | undefined);
    return { data: { key: inputs.key, value }, port: "out" };
  },
});

export const stateDelete = defineNode({
  type: "state.delete",
  app: "state",
  kind: "action",
  category: "State",
  label: "State Delete",
  description: "Delete a shared-state key.",
  inputSchema: z.object({ key: z.string().min(1) }),
  outputs: ["out"],
  execute: async ({ inputs, rt }) => {
    await rt.kv.del(scope(rt.ownerId, inputs.key));
    return { data: { key: inputs.key, deleted: true }, port: "out" };
  },
});

export const stateNodes = [stateGet, stateSet, stateSetNX, stateIncr, stateDelete];
