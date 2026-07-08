import { env } from "../config/env";
import { log } from "./logger";
import { captureToSentry } from "./sentry";

/**
 * Sends an operational alert to all configured sinks: always logs at error
 * level, captures to Sentry (if SENTRY_DSN set), and posts to Slack (if
 * SLACK_ALERT_WEBHOOK set). Each sink is best-effort and independent.
 */
export async function sendAlert(title: string, fields: Record<string, unknown> = {}): Promise<void> {
  log.error(title, fields);
  await captureToSentry(title, fields);

  if (!env.SLACK_ALERT_WEBHOOK) return;
  const text = `:rotating_light: *${title}*\n${Object.entries(fields)
    .map(([k, v]) => `• *${k}*: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join("\n")}`;
  try {
    await fetch(env.SLACK_ALERT_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // best-effort
  }
}
