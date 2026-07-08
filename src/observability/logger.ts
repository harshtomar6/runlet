import { env } from "../config/env";

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogFields = Record<string, unknown>;

/**
 * Structured logger. Always writes JSON to the console; also ships to Axiom
 * when AXIOM_TOKEN + AXIOM_DATASET are set (best-effort, never throws).
 */
function emit(level: Level, msg: string, fields: LogFields): void {
  if (ORDER[level] < ORDER[env.LOG_LEVEL]) return;
  const record = { level, msg, ts: new Date().toISOString(), ...fields };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.log(line);
  void ship(record);
}

async function ship(record: object): Promise<void> {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return;
  try {
    await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.AXIOM_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify([record]),
    });
  } catch {
    // best-effort; never let logging break a run
  }
}

export const log = {
  debug: (msg: string, fields: LogFields = {}) => emit("debug", msg, fields),
  info: (msg: string, fields: LogFields = {}) => emit("info", msg, fields),
  warn: (msg: string, fields: LogFields = {}) => emit("warn", msg, fields),
  error: (msg: string, fields: LogFields = {}) => emit("error", msg, fields),
};
