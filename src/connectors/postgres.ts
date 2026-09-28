import { isIP } from "node:net";
import postgres from "postgres";
import type { DecryptedSecret } from "../domain/types";
import type { PostgresConnector, PostgresQueryInput, PostgresQueryResult } from "./index";
import { resolvePublicHost, type Resolved } from "./ssrf";

type SslMode = "disable" | "require" | "verify-full";

interface Target {
  host: string;
  port: number;
  database?: string;
  user?: string;
  password?: string;
  sslmode: SslMode;
}

/**
 * Parse a `postgres` credential. Secret shape (either form):
 *   { connectionString: "postgres://user:pass@host:5432/db?sslmode=require" }
 *   { host, port?, database?, user?, password?, sslmode? }
 * sslmode follows libpq: `disable` | `require` (default — encrypted, cert not
 * verified) | `verify-full` (`verify-ca` is treated as verify-full).
 */
export function parsePostgresTarget(secret: Record<string, unknown>): Target {
  let t: Omit<Partial<Target>, "sslmode"> & { sslmode?: string };
  if (typeof secret.connectionString === "string") {
    let url: URL;
    try {
      url = new URL(secret.connectionString);
    } catch {
      throw new Error("postgres credential: invalid connectionString");
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error(`postgres credential: unsupported protocol ${url.protocol}`);
    }
    t = {
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
      user: url.username ? decodeURIComponent(url.username) : undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      sslmode: url.searchParams.get("sslmode") ?? undefined,
    };
  } else {
    t = {
      host: secret.host as string | undefined,
      port: secret.port === undefined ? undefined : Number(secret.port),
      database: secret.database as string | undefined,
      user: secret.user as string | undefined,
      password: secret.password as string | undefined,
      sslmode: secret.sslmode as string | undefined,
    };
  }
  if (!t.host) throw new Error("postgres credential: missing host (or connectionString)");
  return {
    host: t.host,
    port: t.port ?? 5432,
    database: t.database,
    user: t.user,
    password: t.password,
    sslmode: normalizeSslMode(t.sslmode),
  };
}

function normalizeSslMode(mode: string | undefined): SslMode {
  if (mode === "disable") return "disable";
  if (mode === "verify-full" || mode === "verify-ca") return "verify-full";
  return "require"; // require / prefer / allow / unset → always encrypt
}

export interface PgConnectorOptions {
  /** Host guard + resolver. Defaults to the SSRF guard (public hosts only). */
  resolveHost?: (host: string) => Promise<Resolved | null>;
}

/**
 * Runs one parameterised SQL statement against a user's Postgres. A fresh
 * single-connection client per call (serverless-friendly, closed in `finally`).
 *
 *  - SSRF: the host must resolve to a public address, and the socket is pinned
 *    to the verified IP (TLS SNI/cert checks still use the original hostname).
 *  - Always the extended protocol → exactly one statement per call, so
 *    `COMMIT; DELETE …` can't escape a read-only transaction.
 *  - `readOnly` wraps the statement in `BEGIN READ ONLY`.
 *  - `statement_timeout` bounds server time; rows are streamed via a cursor and
 *    capped at `maxRows` so a big SELECT can't exhaust memory.
 *
 * Without a credential it dry-runs so flows stay runnable locally.
 */
export class PgPostgresConnector implements PostgresConnector {
  private readonly resolveHost: (host: string) => Promise<Resolved | null>;

  constructor(opts: PgConnectorOptions = {}) {
    this.resolveHost = opts.resolveHost ?? resolvePublicHost;
  }

  async query(creds: DecryptedSecret | null, input: PostgresQueryInput): Promise<PostgresQueryResult> {
    if (!creds) {
      return { rows: [], rowCount: 0, command: null, truncated: false, dryRun: true };
    }
    const target = parsePostgresTarget(creds.secret);
    const pinned = await this.resolveHost(target.host);
    const sniHost = isIP(target.host) ? undefined : target.host;

    const sql = postgres({
      host: pinned?.address ?? target.host,
      port: target.port,
      database: target.database,
      username: target.user,
      password: target.password,
      ssl:
        target.sslmode === "disable"
          ? false
          : { servername: sniHost, rejectUnauthorized: target.sslmode === "verify-full" },
      max: 1,
      prepare: false, // works behind transaction-mode poolers (pgbouncer, Supabase)
      connect_timeout: Math.max(1, Math.ceil(input.timeoutMs / 1000)),
      idle_timeout: 1,
      fetch_types: false,
      onnotice: () => {},
      connection: { application_name: "runlet", statement_timeout: input.timeoutMs },
    });

    try {
      const run = async (q: postgres.Sql | postgres.TransactionSql) => {
        const rows: Record<string, unknown>[] = [];
        let truncated = false;
        const batch = Math.min(input.maxRows + 1, 500);
        const res = await q
          // simple:false is honoured at runtime but missing from the typings.
          .unsafe(input.query, input.values as postgres.ParameterOrJSON<never>[], {
            simple: false,
          } as postgres.UnsafeQueryOptions)
          .cursor(batch, (chunk) => {
            for (const row of chunk) {
              if (rows.length >= input.maxRows) {
                truncated = true;
                return sql.CLOSE;
              }
              // Plain JSON (Date → ISO string) so local and durable runs see the same shape.
              rows.push(JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
            }
          });
        return { rows, truncated, command: res.command ?? null, count: res.count };
      };
      const r = input.readOnly ? await sql.begin("read only", run) : await run(sql);
      return {
        rows: r.rows,
        // Rows returned for SELECT/RETURNING; rows affected for INSERT/UPDATE/DELETE.
        rowCount: r.rows.length > 0 || r.truncated ? r.rows.length : (r.count ?? 0),
        command: r.command,
        truncated: r.truncated,
        dryRun: false,
      };
    } finally {
      await sql.end({ timeout: 1 }).catch(() => {});
    }
  }
}
