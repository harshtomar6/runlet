import { randomBytes } from "node:crypto";
import { env } from "../config/env";
import { newId } from "../domain/ids";
import type { ConnectionMeta } from "../domain/types";
import { ApiError } from "../errors";
import { getProvider as defaultGetProvider } from "../oauth/registry";
import type { OAuthProvider } from "../oauth/types";
import type { KVState, Store } from "../ports";

const STATE_TTL_SEC = 600; // 10 min to complete consent
const stateKey = (state: string): string => `oauth:state:${state}`;

interface StatePayload {
  ownerId: string;
  provider: string;
  returnTo: string | null;
}

/**
 * Drives the Authorization-Code flow, generic over the provider registry.
 * `start` is called server-to-server (owner authenticated) and returns a URL to
 * redirect the browser to; `callback` is hit by the browser and trusts only the
 * single-use, owner-bound `state`.
 */
export class OAuthService {
  constructor(
    private readonly store: Store,
    private readonly kv: KVState,
    private readonly getProvider: (id: string) => OAuthProvider | undefined = defaultGetProvider,
  ) {}

  async start(ownerId: string, providerId: string, opts?: { returnTo?: string }): Promise<{ authorizeUrl: string }> {
    const provider = this.requireProvider(providerId);
    const state = randomBytes(32).toString("base64url");
    const payload: StatePayload = { ownerId, provider: providerId, returnTo: opts?.returnTo ?? null };
    await this.kv.set(stateKey(state), JSON.stringify(payload), STATE_TTL_SEC);
    const authorizeUrl = provider.authorizeUrl({
      state,
      redirectUri: this.redirectUri(providerId),
      scopes: provider.defaultScopes(),
    });
    return { authorizeUrl };
  }

  async callback(
    providerId: string,
    input: { code?: string; state?: string },
  ): Promise<{ connection: ConnectionMeta; returnTo: string | null }> {
    const provider = this.requireProvider(providerId);
    if (!input.state) throw new ApiError(400, "invalid_state", "Missing OAuth state");
    if (!input.code) throw new ApiError(400, "missing_code", "Missing OAuth code");

    // Validate + consume the state (single-use; CSRF + owner binding).
    const raw = await this.kv.get(stateKey(input.state));
    if (!raw) throw new ApiError(400, "invalid_state", "OAuth state is invalid or expired");
    await this.kv.del(stateKey(input.state));
    const payload = JSON.parse(raw) as StatePayload;
    if (payload.provider !== providerId) {
      throw new ApiError(400, "state_provider_mismatch", "OAuth state does not match provider");
    }

    const tokens = await provider.exchangeCode({ code: input.code, redirectUri: this.redirectUri(providerId) });
    const account = provider.accountFromTokens(tokens);
    const connection = await this.store.connections.upsert({
      id: newId(),
      ownerId: payload.ownerId,
      provider: providerId,
      accountId: account.accountId,
      label: account.label,
      scopes: tokens.scopes,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresInSec != null ? new Date(Date.now() + tokens.expiresInSec * 1000) : null,
      raw: tokens.raw,
    });
    return { connection: toMeta(connection), returnTo: payload.returnTo };
  }

  private requireProvider(id: string): OAuthProvider {
    const provider = this.getProvider(id);
    if (!provider) throw new ApiError(404, "unknown_provider", `Unknown OAuth provider: ${id}`);
    if (!provider.isConfigured()) {
      throw new ApiError(503, "provider_unconfigured", `OAuth provider "${id}" is not configured on this server`);
    }
    return provider;
  }

  private redirectUri(providerId: string): string {
    const base = env.OAUTH_REDIRECT_BASE_URL ?? env.PUBLIC_BASE_URL;
    if (!base) throw new ApiError(503, "oauth_base_unset", "OAUTH_REDIRECT_BASE_URL or PUBLIC_BASE_URL must be set");
    return `${base.replace(/\/+$/, "")}/oauth/${providerId}/callback`;
  }
}

function toMeta(c: {
  id: string;
  ownerId: string;
  provider: string;
  accountId: string;
  label: string;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
}): ConnectionMeta {
  return {
    id: c.id,
    ownerId: c.ownerId,
    provider: c.provider,
    accountId: c.accountId,
    label: c.label,
    scopes: c.scopes,
    expiresAt: c.expiresAt,
    createdAt: c.createdAt,
  };
}
