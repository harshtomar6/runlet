import { env } from "../config/env";
import { log } from "./logger";

/**
 * Sends an operational alert. Posts to Slack when SLACK_ALERT_WEBHOOK is set;
 * always logs at error level. (Sentry can be added here later behind a DSN.)
 */
export async function sendAlert(title: string, fields: Record<string, unknown> = {}): Promise<void> {
  log.error(title, fields);
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
