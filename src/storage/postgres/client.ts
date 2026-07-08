import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../../config/env";
import * as schema from "./schema";

let _db: PostgresJsDatabase<typeof schema> | null = null;

/** Lazily-initialised Drizzle client. Connects on first use, not at import. */
export function db(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    if (!env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for the Postgres store");
    }
    const client = postgres(env.DATABASE_URL, { prepare: false });
    _db = drizzle(client, { schema });
  }
  return _db;
}
