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
});

export type Env = z.infer<typeof EnvSchema>;

export const env: Env = EnvSchema.parse(process.env);
