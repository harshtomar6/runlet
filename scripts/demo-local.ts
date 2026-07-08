/**
 * Runs a sample workflow through the interpreter with the in-memory execution
 * context — no Postgres, Redis, or QStash required.
 *
 *   pnpm tsx scripts/demo-local.ts
 */
import { dryRunConnectors } from "../src/connectors/default";
import type { CredentialStore } from "../src/ports";
import type { DecryptedSecret, WorkflowVersion } from "../src/domain/types";
import { LocalExecutionContext } from "../src/engine/local-context";
import { runWorkflow } from "../src/engine/interpreter";
import { MemoryEventSink } from "../src/engine/sink";
import { MemoryKVState } from "../src/storage/memory/kv-state";
import "../src/nodes"; // register catalog

const nullCredentials: CredentialStore = {
  async get(): Promise<DecryptedSecret> {
    throw new Error("no credentials in local demo");
  },
  async put() {},
  async list() {
    return [];
  },
  async delete() {},
};

// Install drip (shortened): send → wait 1d → send → if(subscribed) → send
const def: WorkflowVersion = {
  id: "v1",
  workflowId: "wf1",
  version: 1,
  createdAt: new Date(),
  nodes: [
    { id: "t", type: "trigger.event", params: { eventType: "app.installed" } },
    { id: "e1", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "day-1" } },
    { id: "w", type: "control.wait", params: { duration: "1d" } },
    { id: "e2", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "day-2" } },
    { id: "cond", type: "control.if", params: { condition: "{{ trigger.subscribed }}" } },
    { id: "e3", type: "email.send", params: { to: "{{ trigger.email }}", templateId: "welcome-paid" } },
  ],
  edges: [
    { from: { nodeId: "t", port: "out" }, to: { nodeId: "e1", port: "in" } },
    { from: { nodeId: "e1", port: "success" }, to: { nodeId: "w", port: "in" } },
    { from: { nodeId: "w", port: "out" }, to: { nodeId: "e2", port: "in" } },
    { from: { nodeId: "e2", port: "success" }, to: { nodeId: "cond", port: "in" } },
    { from: { nodeId: "cond", port: "true" }, to: { nodeId: "e3", port: "in" } },
  ],
};

async function main() {
  const sink = new MemoryEventSink();
  const exec = new LocalExecutionContext("demo-run");

  await runWorkflow(exec, {
    runId: "demo-run",
    def,
    trigger: { email: "user@example.com", subscribed: true },
    sink,
    rt: { kv: new MemoryKVState(), credentials: nullCredentials, connectors: dryRunConnectors() },
  });

  console.log("\n=== events ===");
  for (const e of sink.events) {
    const label = e.nodeId ? `${e.type} (${e.nodeId})` : e.type;
    console.log(" ", label);
  }
  console.log("\n=== sleeps ===");
  for (const s of exec.sleeps) console.log(" ", s.stepId, "→", s.seconds, "s");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
