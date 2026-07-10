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

/** Per-expression CPU/time budget (DESIGN §8) — bounds a hostile expression. */
const EVAL_TIMEOUT_MS = 1000;

/** Thrown for genuine expression errors (syntax / evaluation), distinct from a
 *  missing path (which JSONata returns as `undefined`, not an error). */
export class ExpressionError extends Error {
  constructor(expr: string, cause: unknown) {
    super(`Expression failed: "${expr}" — ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "ExpressionError";
  }
}

/** The raw `{{ ... }}` expressions inside a string (full or embedded). */
function extractExpressions(s: string): string[] {
  const full = s.match(FULL);
  if (full) return [(full[1] ?? "").trim()];
  return [...s.matchAll(PART)].map((m) => (m[1] ?? "").trim());
}

/**
 * Statically compile every `{{ expression }}` in a value and report SYNTAX
 * errors. No scope/data needed — catches typos (e.g. `foo..`, unbalanced
 * parens) before a run. Does NOT catch data-dependent runtime errors.
 */
export function expressionSyntaxErrors(value: unknown): Array<{ expr: string; message: string }> {
  const errors: Array<{ expr: string; message: string }> = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const expr of extractExpressions(v)) {
        if (!expr) continue;
        try {
          jsonata(expr);
        } catch (err) {
          errors.push({ expr, message: err instanceof Error ? err.message : String(err) });
        }
      }
    } else if (Array.isArray(v)) {
      for (const item of v) walk(item);
    } else if (v && typeof v === "object") {
      for (const item of Object.values(v)) walk(item);
    }
  };
  walk(value);
  return errors;
}

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

/** `{{ $secret.* }}` is resolved LATE by the node holding the credential, so it
 *  never enters the general scope or the logged inputs. The general pass leaves
 *  it verbatim. */
const referencesSecret = (expr: string): boolean => /\$secret\b/.test(expr);

async function resolveString(value: string, scope: Scope): Promise<unknown> {
  const full = value.match(FULL);
  if (full) {
    if (referencesSecret(full[1] ?? "")) return value; // preserve placeholder
    return evalExpr(full[1] ?? "", scope);
  }

  if (!PART.test(value)) return value;
  PART.lastIndex = 0;

  let out = "";
  let last = 0;
  for (const m of value.matchAll(PART)) {
    out += value.slice(last, m.index);
    const inner = (m[1] ?? "").trim();
    if (referencesSecret(inner)) {
      out += m[0]; // preserve {{ $secret.* }} for late resolution
    } else {
      const v = await evalExpr(inner, scope);
      out += v === undefined || v === null ? "" : String(v);
    }
    last = (m.index ?? 0) + m[0].length;
  }
  out += value.slice(last);
  return out;
}

/**
 * Resolve ONLY `{{ $secret.* }}` placeholders, binding `$secret` to `secret`.
 * A node calls this AFTER its inputs are logged, so credential values never
 * touch the general scope or the run event log.
 */
export async function resolveSecretRefs(value: unknown, secret: Record<string, unknown>): Promise<unknown> {
  if (typeof value === "string") {
    const full = value.match(FULL);
    if (full && referencesSecret(full[1] ?? "")) return evalWithSecret((full[1] ?? "").trim(), secret);
    if (!referencesSecret(value)) return value;
    let out = "";
    let last = 0;
    for (const m of value.matchAll(PART)) {
      out += value.slice(last, m.index);
      const inner = (m[1] ?? "").trim();
      const v = referencesSecret(inner) ? await evalWithSecret(inner, secret) : m[0];
      out += v === undefined || v === null ? "" : String(v);
      last = (m.index ?? 0) + m[0].length;
    }
    out += value.slice(last);
    return out;
  }
  if (Array.isArray(value)) return Promise.all(value.map((v) => resolveSecretRefs(v, secret)));
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) o[k] = await resolveSecretRefs(v, secret);
    return o;
  }
  return value;
}

async function evalWithSecret(expr: string, secret: Record<string, unknown>): Promise<unknown> {
  let compiled: ReturnType<typeof jsonata>;
  try {
    compiled = jsonata(expr);
  } catch (err) {
    throw new ExpressionError(expr, err);
  }
  try {
    return await withTimeout(compiled.evaluate(undefined, { secret }), EVAL_TIMEOUT_MS, expr);
  } catch (err) {
    throw new ExpressionError(expr, err);
  }
}

async function evalExpr(expr: string, scope: Scope): Promise<unknown> {
  // A missing path yields `undefined` (not an error); a syntax/eval failure
  // throws — surface it as ExpressionError instead of silently returning "".
  let compiled: ReturnType<typeof jsonata>;
  try {
    compiled = jsonata(expr);
  } catch (err) {
    throw new ExpressionError(expr, err);
  }
  try {
    return await withTimeout(compiled.evaluate(scope), EVAL_TIMEOUT_MS, expr);
  } catch (err) {
    throw new ExpressionError(expr, err);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, expr: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: "${expr}"`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
