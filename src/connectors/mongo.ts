import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import type { Document, MongoClientOptions } from "mongodb";
import type { DecryptedSecret } from "../domain/types";
import type { MongoOperation, MongoQueryInput, MongoQueryResult, MongoConnector } from "./index";
import { assertPublicHostname, isPrivateAddress, resolvePublicHost } from "./ssrf";

export const MONGO_READ_OPS: ReadonlySet<MongoOperation> = new Set(["find", "findOne", "aggregate", "count", "distinct"]);

/** Password auth only: AWS/OIDC/GSSAPI would pull THIS server's ambient cloud/Kerberos identity. */
const ALLOWED_AUTH = new Set(["DEFAULT", "SCRAM-SHA-1", "SCRAM-SHA-256", "PLAIN"]);
/** Options that read local files or tunnel through a proxy we can't vet. */
const FORBIDDEN_OPTIONS = ["tlsCAFile", "tlsCertificateKeyFile", "tlsCRLFile", "proxyHost"] as const;

/**
 * Parse a `mongodb` credential. Secret shape:
 *   { connectionString: "mongodb+srv://user:pass@cluster0.x.mongodb.net/app", database? }
 */
export function parseMongoCredential(secret: Record<string, unknown>): { uri: string; database?: string } {
  const uri = secret.connectionString;
  if (typeof uri !== "string" || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error("mongodb credential: connectionString must start with mongodb:// or mongodb+srv://");
  }
  return { uri, database: typeof secret.database === "string" ? secret.database : undefined };
}

/**
 * Operation-level rules, enforced before any connection (and in dry-run):
 * read-only mode, per-operation required fields, no accidental mass writes.
 */
export function assertMongoInput(input: MongoQueryInput): void {
  const op = input.operation;
  if (input.readOnly && !MONGO_READ_OPS.has(op)) {
    throw new Error(`mongodb.query: "${op}" writes data — set readOnly: false to allow it`);
  }
  if (op === "aggregate") {
    if (!input.pipeline) throw new Error("mongodb.query: aggregate requires `pipeline`");
    if (input.readOnly && input.pipeline.some((stage) => "$out" in stage || "$merge" in stage)) {
      throw new Error("mongodb.query: $out/$merge write data — set readOnly: false to allow them");
    }
  }
  if (op === "distinct" && !input.field) throw new Error("mongodb.query: distinct requires `field`");
  if (op === "insertOne" && !input.document) throw new Error("mongodb.query: insertOne requires `document`");
  if (op === "insertMany" && !input.documents?.length) {
    throw new Error("mongodb.query: insertMany requires a non-empty `documents` array");
  }
  if ((op === "updateOne" || op === "updateMany") && !input.update) {
    throw new Error(`mongodb.query: ${op} requires \`update\``);
  }
  if ((op === "updateMany" || op === "deleteMany") && Object.keys(input.filter).length === 0) {
    throw new Error(
      `mongodb.query: ${op} with an empty filter would touch every document — ` +
        'pass an explicit filter (e.g. { "_id": { "$exists": true } }) if that is intended',
    );
  }
}

/** The database named in the connection string's path, if any. */
function uriDatabase(uri: string): string | undefined {
  const path = uri.replace(/^mongodb(\+srv)?:\/\/[^/]*/, "").split("?")[0] ?? "";
  const name = decodeURIComponent(path.replace(/^\//, ""));
  return name || undefined;
}

/** Why a server address must not be contacted, or null if it's fine. */
export function unsafeAddress(address: string): string | null {
  if (address.startsWith("/") || address.endsWith(".sock")) return `unix socket ${address}`;
  const host = address.replace(/:\d+$/, "");
  try {
    assertPublicHostname(host);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * `net.connect` lookup that refuses private addresses. The driver resolves hosts
 * itself (SRV targets, replica-set members), so this is where hostnames are
 * vetted — at connect time, so DNS rebinding can't slip past an earlier check.
 */
export function guardedLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  try {
    assertPublicHostname(hostname);
  } catch (err) {
    callback(err as Error, "");
    return;
  }
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad) return callback(new Error(`Blocked private address for ${hostname}: ${bad.address}`), "");
    const first = addresses[0];
    if (!first) return callback(new Error(`Could not resolve ${hostname}`), "");
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  });
}

export interface MongoConnectorOptions {
  /** Tests only: skip the private-address guard (the local test DB is on loopback). */
  allowPrivateHosts?: boolean;
}

/**
 * Runs one MongoDB operation against a user's cluster. A fresh single-connection
 * client per call (serverless-friendly, closed in `finally`).
 *
 *  - SSRF: seed hosts are checked up front; every hostname the driver resolves
 *    (SRV targets, discovered members) goes through `guardedLookup`; IP-literal
 *    members a server advertises are caught on `serverOpening` and the call is
 *    aborted before the operation is sent.
 *  - Connection strings can't read local files (tls*File), use a proxy, or use
 *    ambient-identity auth (AWS/OIDC/Kerberos/X.509).
 *  - Filters/documents are Extended JSON ({ "$oid": … }, { "$date": … }); results
 *    come back as relaxed Extended JSON, so ids round-trip into the next query.
 *  - `timeoutMS` bounds the whole call; cursors stop at `maxRows`.
 *
 * Without a credential it dry-runs so flows stay runnable locally.
 */
export class DriverMongoConnector implements MongoConnector {
  constructor(private readonly opts: MongoConnectorOptions = {}) {}

  async query(creds: DecryptedSecret | null, input: MongoQueryInput): Promise<MongoQueryResult> {
    assertMongoInput(input);
    if (!creds) return { operation: input.operation, dryRun: true };

    const { uri, database: credDatabase } = parseMongoCredential(creds.secret);
    const { MongoClient, BSON } = await import("mongodb"); // lazy: keeps the driver off cold paths
    const guard = !this.opts.allowPrivateHosts;

    const clientOpts: MongoClientOptions = {
      appName: "runlet",
      maxPoolSize: 1,
      timeoutMS: input.timeoutMs,
      serverSelectionTimeoutMS: input.timeoutMs,
      connectTimeoutMS: input.timeoutMs,
      ...(guard ? { lookup: guardedLookup } : {}),
    };
    const client = new MongoClient(uri, clientOpts);
    const parsed = client.options as unknown as Record<string, unknown> & {
      credentials?: { mechanism?: string };
      hosts: Array<{ host?: string; socketPath?: string }>;
    };
    for (const key of FORBIDDEN_OPTIONS) {
      if (parsed[key]) throw new Error(`mongodb credential: connection option "${key}" is not allowed`);
    }
    const mechanism = parsed.credentials?.mechanism;
    if (mechanism && !ALLOWED_AUTH.has(mechanism)) {
      throw new Error(`mongodb credential: authMechanism "${mechanism}" is not supported (use a username/password)`);
    }

    let blocked: string | null = null;
    if (guard) {
      // Fast, clear failure for bad seed hosts: name/literal checks first, then DNS.
      for (const h of parsed.hosts) {
        if (h.socketPath) throw new Error("mongodb credential: unix sockets are not allowed");
        if (h.host) assertPublicHostname(h.host);
      }
      for (const h of parsed.hosts) if (h.host) await resolvePublicHost(h.host);
      client.on("serverOpening", (ev) => {
        const why = unsafeAddress(ev.address);
        if (why && !blocked) {
          blocked = why;
          void client.close();
        }
      });
    }
    const assertSafe = () => {
      if (blocked) throw new Error(`mongodb: refusing to talk to a server the cluster advertised: ${blocked}`);
    };

    const dbName = input.database ?? credDatabase ?? uriDatabase(uri);
    if (!dbName) {
      throw new Error("mongodb.query: no database — set `database` on the node or in the connection string");
    }

    const ejsonIn = <T>(v: T): T => (v === undefined ? v : (BSON.EJSON.deserialize(v as Document) as T));
    const ejsonOut = (v: unknown): unknown => BSON.EJSON.serialize(v as Document, { relaxed: true });
    const idOut = (id: unknown): unknown => (ejsonOut({ id }) as { id: unknown }).id;

    try {
      await client.connect();
      assertSafe();
      const coll = client.db(dbName).collection(input.collection);
      const filter = ejsonIn(input.filter);

      const drain = async (cursor: AsyncIterable<Document> & { close(): Promise<void> }) => {
        const rows: unknown[] = [];
        let truncated = false;
        for await (const doc of cursor) {
          if (rows.length >= input.maxRows) {
            truncated = true;
            break; // breaking closes the cursor
          }
          rows.push(ejsonOut(doc));
        }
        return { rows, rowCount: rows.length, truncated };
      };
      const batchSize = Math.min(input.maxRows + 1, 500);

      let result: Record<string, unknown>;
      switch (input.operation) {
        case "find":
          result = await drain(
            coll.find(filter, {
              projection: ejsonIn(input.projection),
              sort: input.sort as Document | undefined,
              skip: input.skip,
              limit: input.limit,
              batchSize,
            }),
          );
          break;
        case "findOne": {
          const doc = await coll.findOne(filter, {
            projection: ejsonIn(input.projection),
            sort: input.sort as Document | undefined,
            skip: input.skip,
          });
          result = { doc: doc === null ? null : ejsonOut(doc) };
          break;
        }
        case "aggregate":
          result = await drain(coll.aggregate(ejsonIn(input.pipeline ?? []), { batchSize }));
          break;
        case "count":
          result = { count: await coll.countDocuments(filter, { skip: input.skip, limit: input.limit }) };
          break;
        case "distinct": {
          const values = await coll.distinct(input.field ?? "", filter);
          result = {
            values: values.slice(0, input.maxRows).map(ejsonOut),
            truncated: values.length > input.maxRows,
          };
          break;
        }
        case "insertOne": {
          const r = await coll.insertOne(ejsonIn(input.document ?? {}));
          result = { insertedCount: 1, insertedIds: [idOut(r.insertedId)] };
          break;
        }
        case "insertMany": {
          const r = await coll.insertMany(ejsonIn(input.documents ?? []));
          result = { insertedCount: r.insertedCount, insertedIds: Object.values(r.insertedIds).map(idOut) };
          break;
        }
        case "updateOne":
        case "updateMany": {
          const update = ejsonIn(input.update ?? {});
          const opts = { upsert: input.upsert };
          const r =
            input.operation === "updateOne"
              ? await coll.updateOne(filter, update, opts)
              : await coll.updateMany(filter, update, opts);
          result = {
            matchedCount: r.matchedCount,
            modifiedCount: r.modifiedCount,
            upsertedCount: r.upsertedCount,
            upsertedId: r.upsertedId === null ? null : idOut(r.upsertedId),
          };
          break;
        }
        case "deleteOne":
        case "deleteMany": {
          const r = input.operation === "deleteOne" ? await coll.deleteOne(filter) : await coll.deleteMany(filter);
          result = { deletedCount: r.deletedCount };
          break;
        }
      }
      return { operation: input.operation, ...result, dryRun: false };
    } catch (err) {
      assertSafe(); // surface the SSRF reason rather than a generic "client closed"
      throw err;
    } finally {
      await client.close().catch(() => {});
    }
  }
}
