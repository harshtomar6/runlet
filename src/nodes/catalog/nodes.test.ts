import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../../connectors/default";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore } from "../../ports";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeExecArgs, NodeRuntime } from "../define";
import { smtpSend } from "./actions";
import { filterNode, switchNode } from "./control";
import { dataTransform } from "./data";
import { logNode } from "./util";

const nullCreds: CredentialStore = {
  async get(): Promise<DecryptedSecret> {
    throw new Error("no creds");
  },
  async put() {},
  async list() {
    return [];
  },
  async delete() {
    return false;
  },
};

function rt(): NodeRuntime {
  return {
    kv: new MemoryKVState(),
    credentials: nullCreds,
    connectors: dryRunConnectors(),
    runId: "r",
    workflowRunId: "wr",
    stepId: "s1",
  };
}

function args(inputs: Record<string, unknown>): NodeExecArgs {
  return { inputs, params: inputs, rt: rt() };
}

test("control.switch routes to the matching case, else default", async () => {
  assert.equal((await switchNode.execute!(args({ value: "b", cases: [{ equals: "a" }, { equals: "b" }] }))).port, "1");
  assert.equal((await switchNode.execute!(args({ value: "z", cases: [{ equals: "a" }] }))).port, "default");
});

test("control.filter continues on truthy, halts on falsy", async () => {
  assert.equal((await filterNode.execute!(args({ condition: 1 }))).port, "out");
  assert.equal((await filterNode.execute!(args({ condition: 0 }))).port, "stop");
});

test("data.transform outputs the resolved value", async () => {
  const out = await dataTransform.execute!(args({ value: { a: 1 } }));
  assert.deepEqual(out.data, { a: 1 });
});

test("util.log passes the message through", async () => {
  const out = await logNode.execute!(args({ message: "hi", level: "info" }));
  assert.deepEqual(out.data, { message: "hi" });
});

test("email.smtp dry-runs without a credential", async () => {
  const out = await smtpSend.execute!(args({ to: "a@b.com", subject: "Hi" }));
  assert.equal(out.port, "success");
  assert.equal((out.data as { dryRun: boolean }).dryRun, true);
});
