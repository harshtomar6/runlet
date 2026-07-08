import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

/**
 * SSRF-hardened HTTP fetch.
 *
 *  - Only http/https.
 *  - The resolved host must not be loopback/private/link-local/unique-local
 *    (blocks cloud metadata like 169.254.169.254). IPv6 literals are handled
 *    (brackets stripped before the range check).
 *  - Redirects are followed MANUALLY and each hop is re-validated, so a public
 *    URL can't 30x-redirect to an internal host.
 *  - The connection is PINNED to the exact IP we verified (custom undici
 *    dispatcher lookup), closing the DNS-rebinding TOCTOU window between
 *    verification and connect.
 *
 * On edge runtimes without node:dns (e.g. Cloudflare Workers) it degrades to
 * hostname-only checks + a plain fetch (documented in DEPLOY.md).
 */
const MAX_REDIRECTS = 5;

interface Resolved {
  address: string;
  family: number;
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export async function safeFetch(rawUrl: string, init: SafeFetchInit = {}): Promise<UndiciResponse> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const pinned = await verify(current);
    const dispatcher = pinned ? pinnedAgent(pinned) : undefined;
    const res = await undiciFetch(current, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      ...(dispatcher ? { dispatcher } : {}),
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    current = new URL(location, current).toString(); // re-validated on next loop
  }
  throw new Error("Too many redirects");
}

/** Back-compat guard for callers that only want validation. */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  await verify(rawUrl);
}

/** Validate a single URL; returns the pinned IP (or null when DNS is unavailable). */
async function verify(rawUrl: string): Promise<Resolved | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${url.protocol}`);
  }

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // IPv6 literal
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(`Blocked host: ${host}`);
  }

  const literalFamily = isIP(host);
  if (literalFamily) {
    if (isPrivateAddress(host)) throw new Error(`Blocked private address: ${host}`);
    return { address: host, family: literalFamily };
  }

  let lookup: typeof import("node:dns/promises").lookup;
  try {
    ({ lookup } = await import("node:dns/promises"));
  } catch {
    return null; // edge runtime: hostname-only guard already applied above
  }
  const results = await lookup(host, { all: true });
  for (const r of results) {
    if (isPrivateAddress(r.address)) throw new Error(`Blocked private address for ${host}: ${r.address}`);
  }
  const first = results[0];
  if (!first) throw new Error(`Could not resolve ${host}`);
  return { address: first.address, family: first.family };
}

/** An undici Agent that connects only to the pre-verified IP (no re-resolution). */
function pinnedAgent(pinned: Resolved): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options && (options as { all?: boolean }).all) {
          (callback as unknown as (e: Error | null, a: Array<{ address: string; family: number }>) => void)(null, [
            { address: pinned.address, family: pinned.family },
          ]);
        } else {
          (callback as (e: Error | null, a: string, f: number) => void)(null, pinned.address, pinned.family);
        }
      },
    },
  });
}

function isPrivateAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) return isPrivateV4(addr);
  if (v === 6) return isPrivateV6(addr);
  return true; // unknown → block
}

function isPrivateV4(addr: string): boolean {
  const p = addr.split(".").map(Number);
  const [a = 0, b = 0] = p;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local incl. metadata
  if (a === 0) return true;
  return false;
}

function isPrivateV6(addr: string): boolean {
  const a = addr.toLowerCase();
  if (a === "::1" || a === "::") return true; // loopback / unspecified
  if (a.startsWith("fe80")) return true; // link-local
  if (a.startsWith("fc") || a.startsWith("fd")) return true; // unique-local
  if (a.startsWith("::ffff:")) return isPrivateV4(a.slice(7)); // v4-mapped
  return false;
}
