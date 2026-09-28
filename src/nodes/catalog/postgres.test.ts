import assert from "node:assert/strict";
import { test } from "node:test";
import { dryRunConnectors } from "../../connectors/default";
import type { PostgresQueryInput } from "../../connectors";
import type { DecryptedSecret } from "../../domain/types";
import type { CredentialStore } from "../../ports";
import { MemoryConversationStore } from "../../storage/memory/conversation-store";
import { MemoryKVState } from "../../storage/memory/kv-state";
import type { NodeRuntime } from "../define";
import { postgresQuery } from "./postgres";

function rt(onQuery?: (creds: DecryptedSecret | null, input: PostgresQueryInput) => void): NodeRuntime {
  const credentials: CredentialStore = {
    async get(id, ownerId) {
      return { id, type: "postgres", secret: { connectionString: `postgres://${ownerId}@db.example.com/app` } };
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
    connectors.postgres = {
      async query(creds, input) {
        onQuery(creds, input);
        return { rows: [{ id: 1 }], rowCount: 1, command: "SELECT", truncated: false, dryRun: false };
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

test("postgres.query applies schema defaults (read-only, row cap, timeout)", () => {
  const parsed = postgresQuery.inputSchema.parse({ query: "select 1" });
  assert.deepEqual(parsed, { query: "select 1", values: [], readOnly: true, maxRows: 1000, timeoutMs: 15000 });
});

test("postgres.query sends the raw query + resolved values with the owner's credential", async () => {
  let seen: { creds: DecryptedSecret | null; input: PostgresQueryInput } | undefined;
  const params = { query: "select * from orders where id = $1", values: ["{{ trigger.id }}"], credentialId: "c1" };
  const inputs = postgresQuery.inputSchema.parse({ ...params, values: [42] });
  const out = await postgresQuery.execute!({ inputs, params, rt: rt((creds, input) => (seen = { creds, input })) });
  assert.equal(out.port, "success");
  assert.deepEqual(out.data, { rows: [{ id: 1 }], rowCount: 1, command: "SELECT", truncated: false, dryRun: false });
  assert.equal(seen?.creds?.id, "c1");
  assert.equal(seen?.creds?.secret.connectionString, "postgres://o@db.example.com/app");
  assert.deepEqual(seen?.input, {
    query: "select * from orders where id = $1",
    values: [42],
    readOnly: true,
    maxRows: 1000,
    timeoutMs: 15000,
  });
});

test("postgres.query rejects {{ expressions }} in the SQL text", async () => {
  const params = { query: "select * from users where email = '{{ trigger.email }}'" };
  const inputs = postgresQuery.inputSchema.parse({ query: "select * from users where email = 'x' or 1=1 --'" });
  await assert.rejects(postgresQuery.execute!({ inputs, params, rt: rt(() => assert.fail("must not query")) }), /\$1/);
});

test("postgres.query dry-runs without a credential", async () => {
  const inputs = postgresQuery.inputSchema.parse({ query: "select 1" });
  const out = await postgresQuery.execute!({ inputs, params: { query: "select 1" }, rt: rt() });
  assert.deepEqual(out.data, { rows: [], rowCount: 0, command: null, truncated: false, dryRun: true });
});
