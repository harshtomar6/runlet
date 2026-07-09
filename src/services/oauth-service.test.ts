import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthProvider } from "../oauth/types";

// Set the redirect base before importing the service (config/env parses once).
process.env.PUBLIC_BASE_URL = "https://runlet.test";
const { OAuthService } = await import("./oauth-service");
const { MemoryStore } = await import("../storage/memory/store");

const fakeProvider: OAuthProvider = {
  id: "fake",
  isConfigured: () => true,
  defaultScopes: () => ["read", "write"],
  authorizeUrl: ({ state, redirectUri, scopes }) =>
    `https://fake/authorize?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes.join(",")}`,
  exchangeCode: async ({ code }) => ({
    accessToken: `at_${code}`,
    refreshToken: "rt_1",
    expiresInSec: 3600,
    scopes: ["read", "write"],
    raw: { team: { id: "T1", name: "Acme" } },
  }),
  accountFromTokens: (t) => {
    const team = t.raw.team as { id: string; name: string };
    return { accountId: team.id, label: team.name };
  },
};
const getProvider = (id: string): OAuthProvider | undefined => (id === "fake" ? fakeProvider : undefined);

test("start → authorize URL carries a state bound to the redirect URI", async () => {
  const store = new MemoryStore();
  const svc = new OAuthService(store, store.kv, getProvider);
  const { authorizeUrl } = await svc.start("owner-A", "fake", { returnTo: "https://app/done" });
  const u = new URL(authorizeUrl);
  assert.ok(u.searchParams.get("state"));
  assert.equal(u.searchParams.get("redirect_uri"), "https://runlet.test/oauth/fake/callback");
});

test("callback exchanges the code, stores an owner-scoped connection, honors returnTo", async () => {
  const store = new MemoryStore();
  const svc = new OAuthService(store, store.kv, getProvider);
  const { authorizeUrl } = await svc.start("owner-A", "fake", { returnTo: "https://app/done" });
  const state = new URL(authorizeUrl).searchParams.get("state")!;

  const { connection, returnTo } = await svc.callback("fake", { code: "CODE", state });
  assert.equal(connection.provider, "fake");
  assert.equal(connection.accountId, "T1");
  assert.equal(connection.label, "Acme");
  assert.equal(returnTo, "https://app/done");

  // Tokens are stored (owner-scoped get) but never exposed in the metadata list.
  const full = await store.connections.get(connection.id, "owner-A");
  assert.equal(full.accessToken, "at_CODE");
  const list = await store.connections.listByOwner("owner-A");
  assert.equal(list.length, 1);
  assert.equal((list[0] as unknown as Record<string, unknown>).accessToken, undefined);
});

test("state is single-use (replay is rejected) — CSRF protection", async () => {
  const store = new MemoryStore();
  const svc = new OAuthService(store, store.kv, getProvider);
  const { authorizeUrl } = await svc.start("owner-A", "fake");
  const state = new URL(authorizeUrl).searchParams.get("state")!;
  await svc.callback("fake", { code: "CODE", state });
  await assert.rejects(() => svc.callback("fake", { code: "CODE", state }), /invalid or expired/);
});

test("unknown provider is rejected", async () => {
  const store = new MemoryStore();
  const svc = new OAuthService(store, store.kv, getProvider);
  await assert.rejects(() => svc.start("owner-A", "nope"), /Unknown OAuth provider/);
});
