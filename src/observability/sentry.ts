import { randomUUID } from "node:crypto";
import { env } from "../config/env";

/**
 * Minimal Sentry capture via the Store endpoint — avoids pulling in the SDK.
 * No-op when SENTRY_DSN is unset. Best-effort; never throws.
 * DSN format: https://<publicKey>@<host>/<projectId>
 */
export async function captureToSentry(message: string, extra: Record<string, unknown> = {}): Promise<void> {
  if (!env.SENTRY_DSN) return;
  try {
    const dsn = new URL(env.SENTRY_DSN);
    const publicKey = dsn.username;
    const projectId = dsn.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return;
    const endpoint = `${dsn.protocol}//${dsn.host}/api/${projectId}/store/`;
    const body = {
      event_id: randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      level: "error",
      logger: "runlet",
      message,
      extra,
    };
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=runlet/0.1, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // best-effort — alerting must never break the failure path
  }
}
