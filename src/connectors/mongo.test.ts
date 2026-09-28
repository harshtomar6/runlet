import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecryptedSecret } from "../domain/types";
import type { MongoQueryInput } from "./index";
import { lookup } from "node:dns/promises";
import { assertMongoInput, DriverMongoConnector, guardedLookup, parseMongoCredential, unsafeAddress } from "./mongo";

const cred = (secret: Record<string, unknown>): DecryptedSecret => ({ id: "c1", type: "mongodb", secret });
const q = (extra: Partial<MongoQueryInput> = {}): MongoQueryInput => ({
  operation: "find",
  collection: "orders",
  filter: {},
  upsert: false,
  readOnly: true,
  maxRows: 1000,
  timeoutMs: 5000,
  ...extra,
});

test("parseMongoCredential requires a mongodb:// or mongodb+srv:// connection string", () => {
  assert.deepEqual(parseMongoCredential({ connectionString: "mongodb+srv://u:p@c.example.com/app", database: "x" }), {
    uri: "mongodb+srv://u:p@c.example.com/app",
    database: "x",
  });
  assert.throws(() => parseMongoCredential({}), /connectionString/);
  assert.throws(() => parseMongoCredential({ connectionString: "postgres://h/db" }), /connectionString/);
});

test("assertMongoInput: read-only blocks writes and $out/$merge", () => {
  assert.throws(() => assertMongoInput(q({ operation: "insertOne", document: { a: 1 } })), /readOnly: false/);
  assert.throws(() => assertMongoInput(q({ operation: "deleteOne", filter: { a: 1 } })), /readOnly: false/);
  assert.throws(
    () => assertMongoInput(q({ operation: "aggregate", pipeline: [{ $match: {} }, { $out: "copy" }] })),
    /\$out\/\$merge/,
  );
  assert.doesNotThrow(() => assertMongoInput(q({ operation: "aggregate", pipeline: [{ $match: {} }] })));
  assert.doesNotThrow(() =>
    assertMongoInput(q({ operation: "aggregate", pipeline: [{ $merge: "copy" }], readOnly: false })),
  );
});

test("assertMongoInput: per-operation required fields + no accidental mass writes", () => {
  const w = { readOnly: false };
  assert.throws(() => assertMongoInput(q({ operation: "aggregate" })), /pipeline/);
  assert.throws(() => assertMongoInput(q({ operation: "distinct" })), /field/);
  assert.throws(() => assertMongoInput(q({ operation: "insertOne", ...w })), /document/);
  assert.throws(() => assertMongoInput(q({ operation: "insertMany", documents: [], ...w })), /non-empty/);
  assert.throws(() => assertMongoInput(q({ operation: "updateOne", filter: { a: 1 }, ...w })), /update/);
  assert.throws(() => assertMongoInput(q({ operation: "deleteMany", ...w })), /empty filter/);
  assert.throws(() => assertMongoInput(q({ operation: "updateMany", update: { $set: { a: 1 } }, ...w })), /empty filter/);
});

test("dry-runs without a credential (but still enforces the rules)", async () => {
  const pg = new DriverMongoConnector();
  assert.deepEqual(await pg.query(null, q()), { operation: "find", dryRun: true });
  await assert.rejects(pg.query(null, q({ operation: "insertOne", document: {} })), /readOnly/);
});

test("SSRF: refuses private / loopback / metadata seed hosts and unix sockets", async () => {
  const mongo = new DriverMongoConnector();
  for (const uri of [
    "mongodb://localhost:27017/app",
    "mongodb://127.0.0.1/app",
    "mongodb://db.example.com,10.0.0.5/app",
    "mongodb://169.254.169.254/app",
    "mongodb://[::1]/app",
  ]) {
    await assert.rejects(mongo.query(cred({ connectionString: uri }), q()), /Blocked/, uri);
  }
  await assert.rejects(
    mongo.query(cred({ connectionString: "mongodb://%2Ftmp%2Fmongodb-27017.sock/app" }), q()),
    /unix sockets/,
  );
});

test("SSRF: members a cluster advertises are vetted (IP literals, unix sockets)", () => {
  assert.equal(unsafeAddress("cluster0-shard-00-00.abc.mongodb.net:27017"), null);
  assert.equal(unsafeAddress("8.8.8.8:27017"), null);
  assert.match(unsafeAddress("10.0.0.9:27017") ?? "", /Blocked private address/);
  assert.match(unsafeAddress("[::1]:27017") ?? "", /Blocked private address/);
  assert.match(unsafeAddress("/tmp/mongodb-27017.sock") ?? "", /unix socket/);
});

const lookupP = (host: string, all: boolean) =>
  new Promise<unknown>((resolve, reject) =>
    guardedLookup(host, { all }, (err, address) => (err ? reject(err) : resolve(address))),
  );

test("SSRF: the connect-time lookup refuses private names and resolutions", async () => {
  await assert.rejects(lookupP("localhost", false), /Blocked host/);
  // localtest.me publicly resolves to 127.0.0.1 — the DNS-rebinding shape.
  const reachable = await lookup("localtest.me").then(() => true, () => false);
  if (reachable) await assert.rejects(lookupP("localtest.me", true), /Blocked private address for localtest.me/);
});

test("connection strings can't read local files, use a proxy, or use ambient-identity auth", async () => {
  const mongo = new DriverMongoConnector();
  const cases: Array<[string, RegExp]> = [
    ["mongodb://db.example.com/app?tls=true&tlsCAFile=/etc/passwd", /tlsCAFile/],
    ["mongodb://db.example.com/app?tls=true&tlsCertificateKeyFile=/proc/self/environ", /tlsCertificateKeyFile/],
    ["mongodb://db.example.com/app?proxyHost=10.0.0.1", /proxyHost/],
    ["mongodb://db.example.com/app?authMechanism=MONGODB-AWS", /MONGODB-AWS/],
    ["mongodb://u@db.example.com/app?authMechanism=MONGODB-X509&tls=true", /MONGODB-X509/],
  ];
  for (const [uri, re] of cases) {
    await assert.rejects(mongo.query(cred({ connectionString: uri }), q()), re, uri);
  }
});

// ── Live tests against a real MongoDB (skipped unless MONGODB_TEST_URL is set) ──
// e.g. docker run -d -p 57017:27017 mongo:7
//      MONGODB_TEST_URL=mongodb://127.0.0.1:57017/runlet_test pnpm test
const liveUrl = process.env.MONGODB_TEST_URL;
const live = { skip: liveUrl ? false : "MONGODB_TEST_URL not set" };
// The test DB is on loopback, so bypass the SSRF guard (covered above).
const liveMongo = () => new DriverMongoConnector({ allowPrivateHosts: true });
const liveCred = () => cred({ connectionString: liveUrl });
const run = (extra: Partial<MongoQueryInput>) => liveMongo().query(liveCred(), q(extra));
const w = { readOnly: false };

test("live: insert → find → update → delete round-trip, ids as Extended JSON", live, async () => {
  const collection = `rt_${Date.now()}`;
  const ins = await run({
    ...w,
    collection,
    operation: "insertMany",
    documents: [
      { n: 1, status: "open", at: { $date: "2026-01-02T03:04:05Z" } },
      { n: 2, status: "paid" },
      { n: 3, status: "paid" },
    ],
  });
  assert.equal(ins.insertedCount, 3);
  const ids = ins.insertedIds as Array<{ $oid: string }>;
  assert.match(ids[0]!.$oid, /^[0-9a-f]{24}$/);

  const found = await run({
    collection,
    filter: { status: "paid", n: { $gte: 2 } },
    projection: { _id: 0, n: 1 },
    sort: { n: -1 },
  });
  assert.deepEqual(found.rows, [{ n: 3 }, { n: 2 }]);
  assert.equal(found.truncated, false);

  const one = await run({ collection, operation: "findOne", filter: { _id: ids[0] } }); // $oid round-trips
  const doc = one.doc as Record<string, unknown>;
  assert.deepEqual(doc._id, ids[0]);
  assert.deepEqual(doc.at, { $date: "2026-01-02T03:04:05Z" });

  assert.deepEqual((await run({ collection, operation: "count", filter: { status: "paid" } })).count, 2);
  assert.deepEqual(
    ((await run({ collection, operation: "distinct", field: "status" })).values as string[]).sort(),
    ["open", "paid"],
  );
  const agg = await run({
    collection,
    operation: "aggregate",
    pipeline: [{ $group: { _id: "$status", total: { $sum: "$n" } } }, { $sort: { _id: 1 } }],
  });
  assert.deepEqual(agg.rows, [
    { _id: "open", total: 1 },
    { _id: "paid", total: 5 },
  ]);

  const upd = await run({ ...w, collection, operation: "updateMany", filter: { status: "paid" }, update: { $set: { status: "done" } } });
  assert.equal(upd.matchedCount, 2);
  assert.equal(upd.modifiedCount, 2);
  const ups = await run({ ...w, collection, operation: "updateOne", filter: { n: 9 }, update: { $set: { n: 9 } }, upsert: true });
  assert.equal(ups.upsertedCount, 1);
  assert.match((ups.upsertedId as { $oid: string }).$oid, /^[0-9a-f]{24}$/);

  const del = await run({ ...w, collection, operation: "deleteMany", filter: { _id: { $exists: true } } });
  assert.equal(del.deletedCount, 4);
});

test("live: caps rows at maxRows and flags truncation", live, async () => {
  const collection = `cap_${Date.now()}`;
  await run({ ...w, collection, operation: "insertMany", documents: Array.from({ length: 1300 }, (_, i) => ({ i })) });
  try {
    const res = await run({ collection, sort: { i: 1 }, projection: { _id: 0 }, maxRows: 1200 });
    assert.equal((res.rows as unknown[]).length, 1200);
    assert.equal(res.rowCount, 1200);
    assert.equal(res.truncated, true);
    assert.deepEqual((res.rows as unknown[])[1199], { i: 1199 });
    const limited = await run({ collection, limit: 5, maxRows: 1200 });
    assert.equal(limited.rowCount, 5);
    assert.equal(limited.truncated, false);
  } finally {
    await run({ ...w, collection, operation: "deleteMany", filter: { i: { $gte: 0 } } });
  }
});

test("live: timeoutMs bounds slow operations", live, async () => {
  const collection = `slow_${Date.now()}`;
  await run({ ...w, collection, operation: "insertOne", document: { a: 1 } });
  try {
    await assert.rejects(run({ collection, filter: { $where: "sleep(3000) || true" }, timeoutMs: 500 }), /time|expired/i);
  } finally {
    await run({ ...w, collection, operation: "deleteMany", filter: { a: 1 } });
  }
});
