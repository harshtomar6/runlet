import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../../connectors/default";
import type { MongoQueryInput } from "../../connectors";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore } from "../../ports";
import { MemoryConversationStore } from "../../storage/memory/conversation-store";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeRuntime } from "../define";
import { mongodbQuery } from "./mongodb";

function rt(onQuery?: (creds: DecryptedSecret | null, input: MongoQueryInput) => void): NodeRuntime {
  const credentials: CredentialStore = {
    async get(id, ownerId) {
      return { id, type: "mongodb", secret: { connectionString: `mongodb+srv://${ownerId}@c.example.com/app` } };
    },
    async put() {},
    async list() {
      return [];
    },
    async delete() {
      return false;
    },
  };
  const connectors = dryRunConnectors();
  if (onQuery) {
    connectors.mongo = {
      async query(creds, input) {
        onQuery(creds, input);
        return { operation: input.operation, rows: [], dryRun: false };
      },
    };
  }
  return {
    kv: new MemoryKVState(),
    credentials,
    connectors,
    conversations: new MemoryConversationStore(),
    ownerId: "o",
    runId: "r",
    workflowRunId: "wr",
    stepId: "s1",
  };
}

/** Run the node with raw `params` and the `resolved` values an expression pass would produce. */
function exec(params: Record<string, unknown>, resolved: Record<string, unknown>, runtime = rt()) {
  const inputs = mongodbQuery.inputSchema.parse({ ...params, ...resolved });
  return mongodbQuery.execute!({ inputs, params, rt: runtime });
}

test("mongodb.query applies schema defaults (find, read-only, row cap, timeout)", () => {
  assert.deepEqual(mongodbQuery.inputSchema.parse({ collection: "orders" }), {
    operation: "find",
    collection: "orders",
    filter: {},
    upsert: false,
    readOnly: true,
    maxRows: 1000,
    timeoutMs: 15000,
  });
});

test("mongodb.query passes resolved values + the owner's credential to the connector", async () => {
  let seen: { creds: DecryptedSecret | null; input: MongoQueryInput } | undefined;
  const out = await exec(
    { collection: "users", filter: { email: "{{ trigger.email }}", age: { $gte: 18 } }, credentialId: "c1" },
    { filter: { email: "a@b.com", age: { $gte: 18 } } },
    rt((creds, input) => (seen = { creds, input })),
  );
  assert.equal(out.port, "success");
  assert.equal(seen?.creds?.secret.connectionString, "mongodb+srv://o@c.example.com/app");
  assert.deepEqual(seen?.input.filter, { email: "a@b.com", age: { $gte: 18 } });
});

test("mongodb.query rejects operators injected through an expression", async () => {
  const never = rt(() => assert.fail("must not query"));
  // Webhook sends { "email": { "$ne": null } } → would match every user.
  await assert.rejects(
    exec({ collection: "users", filter: { email: "{{ trigger.email }}" } }, { filter: { email: { $ne: null } } }, never),
    /filter\.email came from an expression and contains the operator "\$ne"/,
  );
  // A whole filter from an expression can't smuggle $where either.
  await assert.rejects(
    exec({ collection: "users", filter: "{{ trigger.filter }}" }, { filter: { $where: "sleep(1e9)" } }, never),
    /\$where/,
  );
  // Nested inside a pipeline / update.
  await assert.rejects(
    exec(
      { collection: "u", operation: "aggregate", pipeline: [{ $match: { name: "{{ trigger.q }}" } }] },
      { pipeline: [{ $match: { name: { $regex: ".*" } } }] },
      never,
    ),
    /pipeline\[0\]\.\$match\.name/,
  );
  await assert.rejects(
    exec(
      { collection: "u", operation: "updateOne", readOnly: false, filter: { a: 1 }, update: { $set: "{{ trigger.patch }}" } },
      { update: { $set: { role: { $literal: "admin" } } } },
      never,
    ),
    /\$literal/,
  );
});

test("mongodb.query allows Extended JSON wrappers and literal operators", async () => {
  let seen: MongoQueryInput | undefined;
  await exec(
    { collection: "orders", filter: { _id: "{{ prev.doc._id }}", total: { $gt: "{{ trigger.min }}" } } },
    { filter: { _id: { $oid: "65a1b2c3d4e5f60718293a4b" }, total: { $gt: 10 } } },
    rt((_c, input) => (seen = input)),
  );
  assert.deepEqual(seen?.filter, { _id: { $oid: "65a1b2c3d4e5f60718293a4b" }, total: { $gt: 10 } });
});

test("mongodb.query dry-runs without a credential", async () => {
  const out = await exec({ collection: "orders" }, {});
  assert.deepEqual(out.data, { operation: "find", dryRun: true });
});
