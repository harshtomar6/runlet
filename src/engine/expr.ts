import jsonata from "jsonata";

/**
 * JSONata-powered expression + templating resolver (DESIGN.md §8).
 *
 *  - "{{ expr }}" as an entire string  → the evaluated value (any type)
 *  - "hi {{ name }}"                   → interpolated string
 *  - objects / arrays                  → resolved deeply
 *  - other values                      → returned as-is
 *
 * `expr` is a JSONata expression evaluated against a scope of
 * { trigger, <nodeId>: <output>, ... }. Evaluation is sandboxed by JSONata
 * (no host access) and async.
 */
export type Scope = Record<string, unknown>;

const FULL = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/;
const PART = /\{\{\s*([\s\S]+?)\s*\}\}/g;

export async function resolveValue(value: unknown, scope: Scope): Promise<unknown> {
  if (typeof value === "string") return resolveString(value, scope);
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveValue(v, scope)));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = await resolveValue(v, scope);
    return out;
  }
  return value;
}

export async function resolveInputs(
  params: Record<string, unknown>,
  scope: Scope,
): Promise<Record<string, unknown>> {
  return (await resolveValue(params, scope)) as Record<string, unknown>;
}

export async function evalCondition(expr: string, scope: Scope): Promise<boolean> {
  return Boolean(await resolveString(expr, scope));
}

async function resolveString(value: string, scope: Scope): Promise<unknown> {
  const full = value.match(FULL);
  if (full) return evalExpr(full[1] ?? "", scope);

  if (!PART.test(value)) return value;
  PART.lastIndex = 0;

  let out = "";
  let last = 0;
  for (const m of value.matchAll(PART)) {
    out += value.slice(last, m.index);
    const v = await evalExpr((m[1] ?? "").trim(), scope);
    out += v === undefined || v === null ? "" : String(v);
    last = (m.index ?? 0) + m[0].length;
  }
  out += value.slice(last);
  return out;
}

async function evalExpr(expr: string, scope: Scope): Promise<unknown> {
  try {
    return await jsonata(expr).evaluate(scope);
  } catch {
    return undefined;
  }
}
