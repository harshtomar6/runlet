import assert from "node:assert/strict";
import { test } from "node:test";
import type { Edge, Node } from "../domain/types";
import { validateGraph } from "./validation";
import "../nodes";

const trigger = { type: "event", eventType: "app.installed" } as const;

test("valid linear graph passes", () => {
  const nodes: Node[] = [
    { id: "t", type: "trigger.event", params: { eventType: "app.installed" } },
    { id: "e", type: "email.send", params: { to: "a@b.com", templateId: "x" } },
  ];
  const edges: Edge[] = [{ from: { nodeId: "t", port: "out" }, to: { nodeId: "e", port: "in" } }];
  assert.equal(validateGraph({ trigger, nodes, edges }).ok, true);
});

test("flags unknown type, missing param, orphan, bad port, trigger mismatch", () => {
  const nodes: Node[] = [
    { id: "t", type: "trigger.schedule", params: { cron: "* * * * *" } }, // mismatch vs event
    { id: "e", type: "email.send", params: { to: "a@b.com" } }, // missing templateId
    { id: "x", type: "made.up", params: {} }, // unknown + orphan
  ];
  const edges: Edge[] = [{ from: { nodeId: "t", port: "nope" }, to: { nodeId: "e", port: "in" } }];
  const codes = validateGraph({ trigger, nodes, edges }).errors.map((e) => e.code);

  assert.ok(codes.includes("trigger_mismatch"));
  assert.ok(codes.includes("missing_param"));
  assert.ok(codes.includes("unknown_node_type"));
  assert.ok(codes.includes("invalid_output_port"));
  assert.ok(codes.includes("orphan_node"));
});
