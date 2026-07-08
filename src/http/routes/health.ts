import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { env } from "../../config/env";
import { db } from "../../storage/postgres/client";

export const health = new Hono();

health.get("/", (c) =>
  c.json({
    status: "ok",
    service: "runlet",
    ts: new Date().toISOString(),
  }),
);

/**
 * Body-read diagnostic — public, no DB. Reads the request body and echoes its
 * size. If a POST with a body hangs everywhere but this returns, the request
 * adapter (not the DB) is the problem.
 */
health.post("/echo", async (c) => {
  const text = await c.req.text();
  return c.json({ ok: true, method: c.req.method, bytes: text.length });
});

/**
 * Deep DB check — PUBLIC and unauthenticated ON PURPOSE: the normal auth path
 * hits the DB (API-key lookup), so when the DB is unreachable you can't
 * authenticate to diagnose it. Runs `select 1` and returns the outcome — or the
 * sanitized error (name + message, never the DATABASE_URL) — IN THE RESPONSE,
 * so you don't have to dig through (possibly lost) function logs.
 */
health.get("/db", async (c) => {
  const started = Date.now();
  if (env.STORE === "memory") {
    return c.json({ ok: true, store: "memory" });
  }
  try {
    await db().execute(sql`select 1`);
    return c.json({ ok: true, driver: env.DB_DRIVER, ms: Date.now() - started });
  } catch (err) {
    const e = err as { name?: string; message?: string; cause?: { message?: string } };
    return c.json(
      {
        ok: false,
        driver: env.DB_DRIVER,
        ms: Date.now() - started,
        error: {
          name: e?.name ?? "Error",
          message: String(e?.cause?.message ?? e?.message ?? err).slice(0, 400),
        },
      },
      500,
    );
  }
});
