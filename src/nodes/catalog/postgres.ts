import { z } from "zod";
import { defineNode } from "../define";

export const postgresQuery = defineNode({
  type: "postgres.query",
  app: "postgres",
  kind: "action",
  category: "Postgres",
  label: "Postgres Query",
  description:
    "Runs one SQL statement against your Postgres database and returns { rows, rowCount, command, truncated }. " +
    "Pass dynamic data as `values` bound to $1, $2, … placeholders — `query` is never templated, so " +
    "{{ expressions }} in it are rejected (prevents SQL injection). Read-only by default (`BEGIN READ ONLY`); " +
    "set `readOnly: false` for INSERT/UPDATE/DELETE. Requires a `postgres` credential " +
    "(`{ connectionString }`); the host must be publicly reachable.",
  inputSchema: z.object({
    query: z.string().min(1), // e.g. "select * from orders where status = $1 limit 50"
    values: z.array(z.unknown()).default([]), // bound to $1..$n (expr)
    readOnly: z.boolean().default(true),
    maxRows: z.number().int().positive().max(10_000).default(1_000),
    timeoutMs: z.number().int().min(100).max(60_000).default(15_000),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["postgres"],
  execute: async ({ inputs, params, rt }) => {
    // Use the RAW query: SQL text must never be built from expressions.
    const query = String(params.query ?? "");
    if (query.includes("{{")) {
      throw new Error(
        "postgres.query: `query` can't contain {{ expressions }} — use $1, $2, … placeholders and pass the data in `values`",
      );
    }
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId), rt.ownerId) : null;
    const res = await rt.connectors.postgres.query(creds, {
      query,
      values: inputs.values as unknown[],
      readOnly: inputs.readOnly as boolean,
      maxRows: inputs.maxRows as number,
      timeoutMs: inputs.timeoutMs as number,
    });
    return { data: res, port: "success" };
  },
});

export const postgresNodes = [postgresQuery];
