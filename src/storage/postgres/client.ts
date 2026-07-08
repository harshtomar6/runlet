import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../../config/env";
import * as schema from "./schema";

/** Bound the Neon HTTP request so an unresponsive endpoint fails fast + logged,
 *  instead of hanging the whole request until the platform kills the function. */
// Kept below Vercel's function duration cap (Hobby = 10s) so the timeout fires
// and its error is thrown/logged/returned BEFORE the platform hard-kills the
// function (a kill loses buffered logs → the "timed out with no logs" symptom).
const NEON_TIMEOUT_MS = 7_000;
let neonFetchConfigured = false;
function configureNeonTimeout(): void {
  if (neonFetchConfigured) return;
  neonFetchConfigured = true;
  neonConfig.fetchFunction = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const ctrl = new AbortController();
    const timer = setTimeout(
      () => ctrl.abort(new Error(`Neon HTTP request timed out after ${NEON_TIMEOUT_MS}ms (check DATABASE_URL / DB reachability)`)),
      NEON_TIMEOUT_MS,
    );
    return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };
}

/**
 * Shared DB type. Both the postgres.js and Neon-HTTP drizzle instances expose
 * the same query-builder surface we use, so adapters type against this one.
 */
export type DB = PostgresJsDatabase<typeof schema>;

let _db: DB | null = null;

/**
 * Lazily-initialised Drizzle client. Connects on first use, not at import.
 * DB_DRIVER selects postgres.js (TCP; Node/Vercel/Railway) or Neon-HTTP
 * (Cloudflare Workers / edge, no TCP sockets).
 */
export function db(): DB {
  if (!_db) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for the Postgres store");
    }
    if (env.DB_DRIVER === "neon") {
      configureNeonTimeout();
      _db = drizzleNeon(neon(env.DATABASE_URL), { schema }) as unknown as DB;
    } else {
      // connect_timeout so a stalled TCP connect (common on serverless, where
      // persistent TCP pools don't fit) fails fast with a clear error instead
      // of hanging the request. On serverless prefer DB_DRIVER=neon (HTTP).
      _db = drizzlePg(postgres(env.DATABASE_URL, { prepare: false, connect_timeout: 10 }), { schema });
    }
  }
  return _db;
}
