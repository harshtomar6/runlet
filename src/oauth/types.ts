/** Tokens returned by a provider's code exchange / refresh. */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresInSec: number | null; // null = non-expiring
  scopes: string[];
  raw: Record<string, unknown>; // full provider response (encrypted at rest)
}

/** The external account a connection points at. */
export interface OAuthAccount {
  accountId: string; // team_id / email — stable provider identity + inbound routing key
  label: string; // human name (workspace / email)
}

/**
 * A pluggable OAuth provider. The /oauth routes are generic over this — adding
 * Google/Notion/etc. is a new implementation + env, not new routes.
 */
export interface OAuthProvider {
  id: string; // "slack" | "google" | ...
  /** True when the app's client id/secret are configured (env). */
  isConfigured(): boolean;
  /** Scopes to request at connect time. */
  defaultScopes(): string[];
  /** Build the provider's consent URL to redirect the user's browser to. */
  authorizeUrl(params: { state: string; redirectUri: string; scopes: string[] }): string;
  /** Exchange the callback `code` for tokens. */
  exchangeCode(params: { code: string; redirectUri: string }): Promise<OAuthTokens>;
  /** Refresh an access token (omit for providers whose tokens don't expire). */
  refresh?(refreshToken: string): Promise<OAuthTokens>;
  /** Derive the account identity, ideally from the exchange response. */
  accountFromTokens(tokens: OAuthTokens): OAuthAccount;
}
