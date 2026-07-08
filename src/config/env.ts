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

  // Email provider (Resend) — optional; without it, email.send is a dry-run.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("automations@example.com"),

  // OpenRouter — fallback for ai.complete when no `openrouter` credential is set.
  OPENROUTER_API_KEY: z.string().optional(),

  // Public base URL of this service (for QStash schedule destinations).
  PUBLIC_BASE_URL: z.string().url().optional(),
  // Shared secret protecting internal trigger endpoints (schedule ticks).
  INTERNAL_SECRET: z.string().optional(),
  // Optional HMAC secret; when set, /hooks/:id requires a valid x-signature.
  WEBHOOK_SECRET: z.string().optional(),

  // Dev-only auth bypass: when set, all authed requests use this owner id and
  // skip API-key verification. NEVER set in production.
  AUTH_DEV_OWNER: z.string().optional(),

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
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
