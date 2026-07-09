import { env } from "../config/env";
import type { OAuthAccount, OAuthProvider, OAuthTokens } from "./types";

const AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";

/** Split a "a,b c" scope string into a clean list. */
function parseScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Slack OAuth v2. The bot `access_token` and the `team` identity both come back
 * in the code-exchange response, so no separate account fetch is needed. Bot
 * tokens don't expire (no refresh) unless token rotation is enabled.
 */
export const slackProvider: OAuthProvider = {
  id: "slack",

  isConfigured() {
    return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
  },

  defaultScopes() {
    return parseScopes(env.SLACK_SCOPES);
  },

  authorizeUrl({ state, redirectUri, scopes }) {
    const u = new URL(AUTHORIZE_URL);
    u.searchParams.set("client_id", env.SLACK_CLIENT_ID ?? "");
    u.searchParams.set("scope", scopes.join(","));
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", state);
    return u.toString();
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID ?? "",
        client_secret: env.SLACK_CLIENT_SECRET ?? "",
        code,
        redirect_uri: redirectUri,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!json.ok) throw new Error(`Slack OAuth failed: ${String(json.error ?? "unknown_error")}`);
    return {
      accessToken: String(json.access_token ?? ""),
      refreshToken: (json.refresh_token as string | undefined) ?? null,
      // Slack bot tokens are non-expiring unless token rotation is enabled.
      expiresInSec: typeof json.expires_in === "number" ? json.expires_in : null,
      scopes: typeof json.scope === "string" ? json.scope.split(",").filter(Boolean) : [],
      raw: json,
    };
  },

  accountFromTokens(tokens: OAuthTokens): OAuthAccount {
    const team = tokens.raw.team as { id?: string; name?: string } | undefined;
    return { accountId: team?.id ?? "unknown", label: team?.name ?? team?.id ?? "Slack workspace" };
  },
};
