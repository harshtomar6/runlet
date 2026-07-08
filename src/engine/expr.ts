/**
 * Minimal expression + templating resolver for M3.
 *
 *  - "{{ path.to.value }}" as an entire string  → the resolved value (any type)
 *  - "hi {{ name }}"                             → interpolated string
 *  - non-string values                          → returned as-is
 *
 * Paths resolve against a scope of { trigger, <nodeId>: <output>, ... }.
 * Replaced by JSONata in M7 (see DESIGN.md §8); the signature stays stable.
 */
export type Scope = Record<string, unknown>;

const FULL = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
const PART = /\{\{\s*([^}]+?)\s*\}\}/g;

export function resolveValue(value: unknown, scope: Scope): unknown {
  if (typeof value !== "string") return value;

  const full = value.match(FULL);
  if (full) return lookup(full[1] ?? "", scope);

  return value.replace(PART, (_m, path: string) => {
    const v = lookup(path.trim(), scope);
    return v === undefined || v === null ? "" : String(v);
  });
}

export function resolveInputs(params: Record<string, unknown>, scope: Scope): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    out[k] = resolveValue(v, scope);
  }
  return out;
}

/** Truthiness of a condition expression (M3: value-based, not a full parser). */
export function evalCondition(expr: string, scope: Scope): boolean {
  return Boolean(resolveValue(expr, scope));
}

function lookup(path: string, scope: Scope): unknown {
  let cur: unknown = scope;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
