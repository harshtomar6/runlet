import { z } from "zod";
import type { MongoOperation } from "../../connectors";
import { defineNode } from "../define";

const doc = z.record(z.unknown());

/** Extended JSON type wrappers an expression MAY produce (values, not query operators). */
const EJSON_WRAPPERS = new Set([
  "$oid",
  "$date",
  "$numberInt",
  "$numberLong",
  "$numberDouble",
  "$numberDecimal",
  "$binary",
  "$uuid",
  "$timestamp",
]);

/** Params that are sent to the server as query/update/document structure. */
const GUARDED = ["filter", "projection", "sort", "pipeline", "document", "documents", "update"] as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function assertOperatorFree(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertOperatorFree(v, `${path}[${i}]`));
    return;
  }
  if (!isObj(value)) return;
  const keys = Object.keys(value);
  if (keys.length === 1 && EJSON_WRAPPERS.has(keys[0] ?? "")) return; // e.g. { "$oid": "…" }
  for (const k of keys) {
    if (k.startsWith("$")) {
      throw new Error(
        `mongodb.query: ${path} came from an expression and contains the operator "${k}". ` +
          "Operators must be written literally in the node params — only values may come from {{ expressions }}.",
      );
    }
    assertOperatorFree(value[k], `${path}.${k}`);
  }
}

/**
 * Operator-injection guard. A whole-value `{{ expr }}` resolves to raw JSON, so
 * `{ "email": "{{ trigger.email }}" }` fed `{ "$ne": null }` would match every
 * document. Walk the raw params beside the resolved inputs and reject `$` keys in
 * any subtree an expression produced (Extended JSON wrappers like $oid are fine).
 */
export function assertNoInjectedOperators(raw: unknown, resolved: unknown, path: string): void {
  if (typeof raw === "string") {
    if (raw.includes("{{")) assertOperatorFree(resolved, path);
    return;
  }
  if (Array.isArray(raw) && Array.isArray(resolved)) {
    raw.forEach((r, i) => assertNoInjectedOperators(r, resolved[i], `${path}[${i}]`));
  } else if (isObj(raw) && isObj(resolved)) {
    for (const k of Object.keys(raw)) assertNoInjectedOperators(raw[k], resolved[k], `${path}.${k}`);
  }
}

export const mongodbQuery = defineNode({
  type: "mongodb.query",
  app: "mongodb",
  kind: "action",
  category: "MongoDB",
  label: "MongoDB",
  description:
    "Runs one MongoDB operation (find, findOne, aggregate, count, distinct, insertOne/Many, updateOne/Many, " +
    "deleteOne/Many) against your cluster. Filters and documents are Extended JSON (`{ \"$oid\": \"…\" }`, " +
    "`{ \"$date\": \"…\" }`); results come back the same way. Values may come from {{ expressions }}, but " +
    "operators ($gt, $in, …) must be written literally — expression-produced `$` keys are rejected " +
    "(prevents operator injection). Read-only by default; set `readOnly: false` for writes. Requires a " +
    "`mongodb` credential (`{ connectionString }`); the cluster must be publicly reachable.",
  inputSchema: z.object({
    operation: z
      .enum([
        "find",
        "findOne",
        "aggregate",
        "count",
        "distinct",
        "insertOne",
        "insertMany",
        "updateOne",
        "updateMany",
        "deleteOne",
        "deleteMany",
      ])
      .default("find"),
    collection: z.string().min(1),
    database: z.string().min(1).optional(), // default: credential / connection-string database
    filter: doc.default({}),
    projection: doc.optional(),
    sort: doc.optional(),
    limit: z.number().int().positive().optional(),
    skip: z.number().int().min(0).optional(),
    pipeline: z.array(doc).optional(), // aggregate
    field: z.string().min(1).optional(), // distinct
    document: doc.optional(), // insertOne
    documents: z.array(doc).max(10_000).optional(), // insertMany
    update: z.union([doc, z.array(doc)]).optional(), // update operators, or an update pipeline
    upsert: z.boolean().default(false),
    readOnly: z.boolean().default(true),
    maxRows: z.number().int().positive().max(10_000).default(1_000),
    timeoutMs: z.number().int().min(100).max(60_000).default(15_000),
    credentialId: z.string().optional(),
  }),
  outputs: ["success", "error"],
  credentials: ["mongodb"],
  execute: async ({ inputs, params, rt }) => {
    for (const key of GUARDED) assertNoInjectedOperators(params[key], inputs[key], key);
    const creds = params.credentialId ? await rt.credentials.get(String(params.credentialId), rt.ownerId) : null;
    const res = await rt.connectors.mongo.query(creds, {
      operation: inputs.operation as MongoOperation,
      collection: String(inputs.collection),
      database: inputs.database as string | undefined,
      filter: inputs.filter as Record<string, unknown>,
      projection: inputs.projection as Record<string, unknown> | undefined,
      sort: inputs.sort as Record<string, unknown> | undefined,
      limit: inputs.limit as number | undefined,
      skip: inputs.skip as number | undefined,
      pipeline: inputs.pipeline as Record<string, unknown>[] | undefined,
      field: inputs.field as string | undefined,
      document: inputs.document as Record<string, unknown> | undefined,
      documents: inputs.documents as Record<string, unknown>[] | undefined,
      update: inputs.update as Record<string, unknown> | Record<string, unknown>[] | undefined,
      upsert: inputs.upsert as boolean,
      readOnly: inputs.readOnly as boolean,
      maxRows: inputs.maxRows as number,
      timeoutMs: inputs.timeoutMs as number,
    });
    return { data: res, port: "success" };
  },
});

export const mongodbNodes = [mongodbQuery];
