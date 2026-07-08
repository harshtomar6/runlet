const UNITS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/** Parse a duration like "30s", "15m", "2h", "1d", "1w" into seconds. */
export function parseDuration(input: string): number {
  const m = input.trim().match(/^(\d+)\s*([smhdw])$/i);
  if (!m) throw new Error(`Invalid duration: "${input}" (expected e.g. 30s, 2h, 1d)`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "s").toLowerCase();
  return n * (UNITS[unit] ?? 1);
}
