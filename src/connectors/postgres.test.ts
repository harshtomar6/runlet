import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecryptedSecret } from "../domain/types";
import type { PostgresQueryInput } from "./index";
import { parsePostgresTarget, PgPostgresConnector } from "./postgres";

const cred = (secret: Record<string, unknown>): DecryptedSecret => ({ id: "c1", type: "postgres", secret });
const q = (query: string, extra: Partial<PostgresQueryInput> = {}): PostgresQueryInput => ({
  query,
  values: [],
  readOnly: true,
  maxRows: 1000,
  timeoutMs: 5000,
  ...extra,
});

test("parsePostgresTarget reads a connection string (decoded, sslmode, default port)", () => {
  const t = parsePostgresTarget({ connectionString: "postgresql://us%40r:p%3Ass@db.example.com/app?sslmode=verify-full" });
  assert.deepEqual(t, {
    host: "db.example.com",
    port: 5432,
    database: "app",
    user: "us@r",
    password: "p:ss",
    sslmode: "verify-full",
  });
});

test("parsePostgresTarget reads discrete fields; sslmode defaults to require", () => {
  const t = parsePostgresTarget({ host: "db.example.com", port: "6543", database: "d", user: "u", password: "p" });
  assert.equal(t.port, 6543);
  assert.equal(t.sslmode, "require");
  assert.equal(parsePostgresTarget({ host: "h", sslmode: "disable" }).sslmode, "disable");
  assert.equal(parsePostgresTarget({ host: "h", sslmode: "verify-ca" }).sslmode, "verify-full");
});

test("parsePostgresTarget rejects bad credentials", () => {
  assert.throws(() => parsePostgresTarget({}), /missing host/);
  assert.throws(() => parsePostgresTarget({ connectionString: "mysql://h/db" }), /unsupported protocol/);
  assert.throws(() => parsePostgresTarget({ connectionString: "not a url" }), /invalid connectionString/);
});

test("dry-runs without a credential", async () => {
  const res = await new PgPostgresConnector().query(null, q("select 1"));
  assert.equal(res.dryRun, true);
  assert.deepEqual(res.rows, []);
});

test("SSRF: refuses private / loopback / metadata hosts before connecting", async () => {
  const pg = new PgPostgresConnector();
  for (const url of [
    "postgres://u:p@localhost/db",
    "postgres://u:p@127.0.0.1/db",
    "postgres://u:p@10.0.0.5/db",
    "postgres://u:p@169.254.169.254/db",
    "postgres://u:p@[::1]/db",
  ]) {
    await assert.rejects(pg.query(cred({ connectionString: url }), q("select 1")), /Blocked/, url);
  }
});

// ── Live tests against a real Postgres (skipped unless POSTGRES_TEST_URL is set) ──
// e.g. docker run -d -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
//      POSTGRES_TEST_URL=postgres://postgres:pw@127.0.0.1:55432/postgres?sslmode=disable pnpm test
const liveUrl = process.env.POSTGRES_TEST_URL;
const live = { skip: liveUrl ? false : "POSTGRES_TEST_URL not set" };
// The test DB is on loopback, so bypass the SSRF guard (covered above).
const livePg = () => new PgPostgresConnector({ resolveHost: async () => null });
const liveCred = () => cred({ connectionString: liveUrl });

test("live: binds $n values and returns rows", live, async () => {
  const res = await livePg().query(liveCred(), q("select $1::int + 1 as n, $2::text as s", { values: [41, "hi"] }));
  assert.deepEqual(res.rows, [{ n: 42, s: "hi" }]);
  assert.equal(res.rowCount, 1);
  assert.equal(res.command, "SELECT");
  assert.equal(res.truncated, false);
  assert.equal(res.dryRun, false);
});

test("live: rows are plain JSON (int8/numeric as strings, timestamps as ISO)", live, async () => {
  const res = await livePg().query(
    liveCred(),
    q("select 9007199254740993::int8 as big, 1.50::numeric as num, '2026-01-02T03:04:05Z'::timestamptz as ts"),
  );
  assert.deepEqual(res.rows, [{ big: "9007199254740993", num: "1.50", ts: "2026-01-02T03:04:05.000Z" }]);
});

test("live: caps rows at maxRows and flags truncation", live, async () => {
  const res = await livePg().query(liveCred(), q("select g from generate_series(1, 2500) g", { maxRows: 1200 }));
  assert.equal(res.rows.length, 1200);
  assert.equal(res.rowCount, 1200);
  assert.equal(res.truncated, true);
  assert.deepEqual(res.rows[1199], { g: 1200 });
});

test("live: readOnly (default) blocks writes", live, async () => {
  await assert.rejects(
    livePg().query(liveCred(), q("create table runlet_ro_probe(x int)")),
    /read-only transaction/,
  );
});

test("live: multiple statements are rejected (can't COMMIT out of read-only)", live, async () => {
  await assert.rejects(
    livePg().query(liveCred(), q("commit; create table runlet_escape_probe(x int)")),
    /multiple commands|cannot insert multiple/i,
  );
  const check = await livePg().query(liveCred(), q("select to_regclass('runlet_escape_probe')::text as t"));
  assert.deepEqual(check.rows, [{ t: null }]);
});

test("live: readOnly=false allows writes and reports rows affected", live, async () => {
  const pg = livePg();
  const w = { readOnly: false };
  await pg.query(liveCred(), q("create table if not exists runlet_rw_probe(x int)", w));
  try {
    const ins = await pg.query(liveCred(), q("insert into runlet_rw_probe select generate_series(1, 3)", w));
    assert.equal(ins.command, "INSERT");
    assert.equal(ins.rowCount, 3);
    assert.deepEqual(ins.rows, []);
    const ret = await pg.query(liveCred(), q("delete from runlet_rw_probe where x > $1 returning x", { ...w, values: [1] }));
    assert.equal(ret.command, "DELETE");
    assert.deepEqual(ret.rows, [{ x: 2 }, { x: 3 }]);
  } finally {
    await pg.query(liveCred(), q("drop table if exists runlet_rw_probe", w));
  }
});

test("live: statement_timeout bounds long queries", live, async () => {
  await assert.rejects(
    livePg().query(liveCred(), q("select pg_sleep(5)", { timeoutMs: 300 })),
    /statement timeout/,
  );
});
