import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards outbound HTTP against SSRF: only http/https, and the resolved host
 * must not be loopback/private/link-local/unique-local (blocks cloud metadata
 * endpoints like 169.254.169.254). Throws on violation.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked protocol: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new Error(`Blocked host: ${host}`);
  }

  const literal = isIP(host);
  const addresses = literal
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);

  for (const addr of addresses) {
    if (isPrivateAddress(addr)) throw new Error(`Blocked private address for ${host}: ${addr}`);
  }
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
