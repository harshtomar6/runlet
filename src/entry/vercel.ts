// Vercel entry (Node.js runtime). Pre-bundled into api/_app.mjs by `vercel-build`.
//
// We DON'T use @hono/node-server/vercel here: its adapter reads the request body
// as a stream, but Vercel's Node runtime buffers/consumes the body before the
// function runs, so that stream never ends and `c.req.json()` hangs forever
// (every GET route worked; the first POST-with-body hung). Instead we read the
// body ourselves — from the raw stream when available (preserves exact bytes for
// webhook HMAC), falling back to Vercel's pre-parsed `req.body` — with a timeout
// so it can never hang, then hand a Web Request to Hono.
import { createApp } from "../http/app";

export const runtime = "nodejs";

const app = createApp();

// Node's IncomingMessage/ServerResponse, kept loose to avoid a @types/node dep here.
type NodeReq = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | Uint8Array | string>;
};
type NodeRes = {
  statusCode: number;
  setHeader(k: string, v: string): void;
  end(chunk?: Buffer | string): void;
};

const BODY_READ_TIMEOUT_MS = 5_000;

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  try {
    const method = req.method ?? "GET";
    const host = firstHeader(req.headers["x-forwarded-host"]) ?? firstHeader(req.headers.host) ?? "localhost";
    const proto = firstHeader(req.headers["x-forwarded-proto"]) ?? "https";
    const url = `${proto}://${host}${req.url ?? "/"}`;

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) for (const vv of v) headers.append(k, vv);
      else if (v != null) headers.set(k, String(v));
    }

    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await readBody(req) : undefined;

    const response = await app.fetch(new Request(url, { method, headers, body }));

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: null,
        error: { code: "adapter_error", message: err instanceof Error ? err.message : String(err) },
      }),
    );
  }
}

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function readBody(req: NodeReq): Promise<Buffer | undefined> {
  // Prefer the raw stream (exact bytes). Race a timeout so a stream that never
  // ends (Vercel already drained it) can't hang the request.
  const fromStream = await Promise.race([
    (async () => {
      if (typeof req[Symbol.asyncIterator] !== "function") return null;
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer | Uint8Array | string>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return chunks.length ? Buffer.concat(chunks) : null;
    })().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), BODY_READ_TIMEOUT_MS)),
  ]);
  if (fromStream) return fromStream;

  // Fallback: Vercel pre-parsed the body onto req.body.
  const b = req.body;
  if (b == null) return undefined;
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b);
  return Buffer.from(JSON.stringify(b));
}
