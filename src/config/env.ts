import { z } from "zod";

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

  WORKFLOW_STORE: z.enum(["postgres"]).default("postgres"),
  EVENT_STORE: z.enum(["postgres"]).default("postgres"),
  CRED_STORE: z.enum(["postgres"]).default("postgres"),

  DATABASE_URL: z.string().url().optional(),

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

  // Public base URL of this service (for QStash schedule destinations).
  PUBLIC_BASE_URL: z.string().url().optional(),
  // Shared secret protecting internal trigger endpoints (schedule ticks).
  INTERNAL_SECRET: z.string().optional(),
  // Optional HMAC secret; when set, /hooks/:id requires a valid x-signature.
  WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
