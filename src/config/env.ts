import { z } from "zod";

// Load a local .env for dev and CLI scripts (pnpm dev / create-api-key / demo).
// tsx doesn't auto-load .env, so without this DATABASE_URL & friends never reach
// process.env. Guarded: no-op on serverless/edge (Vercel/Cloudflare) where
// `process.loadEnvFile` is absent and the platform injects env, and non-fatal
// when no .env exists. Real shell/platform vars always win over .env.
if (typeof process !== "undefined" && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file (or no filesystem) — fall back to the ambient environment.
  }
}

/**
 * Environment configuration, parsed and validated once at import time.
 *
 * Connection-level vars (DATABASE_URL, Upstash, enc key) are optional here so
 * the process can boot for health checks without a full backing stack. The
 * individual storage adapters assert what they need lazily, on first use.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  // Storage backend for the whole app. "memory" = in-process, non-persistent
  // (zero infra — great for local dev/trying it out; data is lost on restart).
  // "postgres" = the Postgres + Redis adapters (production).
  STORE: z.enum(["postgres", "memory"]).default("postgres"),

  WORKFLOW_STORE: z.enum(["postgres"]).default("postgres"),
  EVENT_STORE: z.enum(["postgres"]).default("postgres"),
  CRED_STORE: z.enum(["postgres"]).default("postgres"),

  DATABASE_URL: z.string().url().optional(),
  // "postgres" = postgres.js over TCP (Node/Vercel/Railway);
  // "neon" = Neon serverless HTTP driver (Cloudflare Workers / edge).
  DB_DRIVER: z.enum(["postgres", "neon"]).default("postgres"),

  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  CREDENTIAL_ENC_KEY: z.string().optional(),

  ENGINE_URL: z.string().url().optional(),

  // Execution dispatch: "local" runs the interpreter inline (dev/no infra);
  // "qstash" enqueues a durable run to the engine endpoint.
  DISPATCH_MODE: z.enum(["local", "qstash"]).default("local"),
  QSTASH_TOKEN: z.string().optional(),
  // Signature-verification keys read by @upstash/workflow's serve() on /engine.
  // The SDK reads these from process.env directly; declared here for validation
  // + discoverability. Required in qstash mode (see superRefine below).
  QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
  QSTASH_NEXT_SIGNING_KEY: z.string().optional(),
  // Only for the local QStash dev server; unset in production.
  QSTASH_URL: z.string().url().optional(),

  // Email provider (Resend) — optional; without it, email.send is a dry-run.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("automations@example.com"),

  // OpenRouter — fallback for ai.complete when no `openrouter` credential is set.
  OPENROUTER_API_KEY: z.string().optional(),

  // Public base URL of this service (for QStash schedule destinations).
  PUBLIC_BASE_URL: z.string().url().optional(),

  // OAuth (account connections). One Runlet-owned app per provider; owners connect
  // their own account. Base for the callback redirect URI (defaults to PUBLIC_BASE_URL);
  // OAUTH_SUCCESS_REDIRECT is where the browser lands after a successful connect.
  OAUTH_REDIRECT_BASE_URL: z.string().url().optional(),
  OAUTH_SUCCESS_REDIRECT: z.string().url().optional(),
  // Slack app (Web API / OAuth v2). Space/comma-separated bot scopes.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SCOPES: z.string().default("chat:write,chat:write.public"),
  // Slack signing secret — verifies inbound POST /slack/events. Required in prod
  // to accept events (fail-closed, like WEBHOOK_SECRET).
  SLACK_SIGNING_SECRET: z.string().optional(),
  // Shared secret protecting internal trigger endpoints (schedule ticks).
  INTERNAL_SECRET: z.string().optional(),
  // Shared secret protecting the admin provisioning endpoints (POST /admin/tenants).
  ADMIN_SECRET: z.string().optional(),
  // Optional HMAC secret; when set, /hooks/:id requires a valid x-signature.
  WEBHOOK_SECRET: z.string().optional(),

  // Dev-only auth bypass: when set, all authed requests use this owner id and
  // skip API-key verification. NEVER set in production.
  AUTH_DEV_OWNER: z.string().optional(),

  // CORS: comma-separated allowed origins for browser clients. Unset => "*"
  // (safe here — auth is a bearer token, not cookies, so no CSRF surface).
  // Set to e.g. "https://app.example.com,https://admin.example.com" to restrict.
  CORS_ORIGINS: z.string().optional(),

  // Observability (all optional; absent => console-only / no alerts).
  AXIOM_TOKEN: z.string().optional(),
  AXIOM_DATASET: z.string().optional(),
  SLACK_ALERT_WEBHOOK: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
}).superRefine((val, ctx) => {
  // Fail closed: the app must never boot with auth bypassed in production.
  if (val.NODE_ENV === "production" && val.AUTH_DEV_OWNER) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_DEV_OWNER"],
      message: "AUTH_DEV_OWNER must not be set when NODE_ENV=production (it disables authentication)",
    });
  }
  // Fail closed: in production qstash mode, the /engine endpoint MUST verify QStash
  // signatures — otherwise it's publicly invocable. Require both signing keys.
  if (val.NODE_ENV === "production" && val.DISPATCH_MODE === "qstash") {
    for (const key of ["QSTASH_CURRENT_SIGNING_KEY", "QSTASH_NEXT_SIGNING_KEY"] as const) {
      if (!val[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when NODE_ENV=production and DISPATCH_MODE=qstash (it verifies inbound QStash requests to /engine)`,
        });
      }
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
