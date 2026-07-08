# Deployment Targets

The app is a portable Hono server built around a platform-agnostic `createApp()`
(`src/http/app.ts`). Three targets are supported via thin entry points. Pick one.

| Target | Entry | DB driver | Status |
|---|---|---|---|
| **Node** (Railway / Fly / Render / container) | `src/index.ts` | `postgres` | ✅ fully supported |
| **Vercel** | `api/index.ts` → `src/entry/vercel.ts` | `postgres` | ✅ fully supported |
| **Cloudflare Workers** | `src/entry/cloudflare.ts` | `neon` | ⚠️ experimental (caveats below) |

All targets share the same env vars (see `.env.example`). In production set
`DISPATCH_MODE=qstash` and configure QStash to reach `ENGINE_URL`
(`https://<host>/engine`), plus `PUBLIC_BASE_URL` for schedule ticks.

---

## Common prerequisites
- Provision Postgres (Neon), Upstash Redis, Upstash QStash.
- Run migrations against prod: `pnpm db:migrate`.
- Mint an API key: `pnpm create-api-key --owner <id> --name "server"`.
- Set secrets: `CREDENTIAL_ENC_KEY`, `INTERNAL_SECRET`, optional `WEBHOOK_SECRET`.

---

## Node — Railway / Fly / Render / any container

Production runs via `tsx` (no build step needed): `pnpm start` → `tsx src/index.ts`, listening on `PORT`.

**Railway**: point it at the repo. Nixpacks detects Node and runs `pnpm start`, or use the included **`Dockerfile`**. Set env vars in the Railway dashboard. `DB_DRIVER=postgres`.

**Docker (any host)**:
```bash
docker build -t app-automations .
docker run -p 3000:3000 --env-file .env app-automations
```

Set `PUBLIC_BASE_URL` / `ENGINE_URL` to the public URL Railway/host assigns.

---

## Vercel

`api/index.ts` exposes the app as a Node serverless function; `vercel.json`
rewrites all paths to it.

```bash
vercel deploy   # or connect the repo in the Vercel dashboard
```

- Runtime: Node (`export const runtime = "nodejs"` in the entry). `DB_DRIVER=postgres`.
- Set env vars in Project Settings. `ENGINE_URL=https://<proj>.vercel.app/engine`.
- Note: serverless functions are request-scoped — durable steps are handled by
  QStash calling back into `/engine`, so this is fine.

---

## Cloudflare Workers (experimental)

Workers has no TCP sockets and a partial `node:*` surface, so two things change:

1. **DB driver must be `neon`** — uses the Neon serverless HTTP driver
   (`@neondatabase/serverless` + `drizzle-orm/neon-http`) instead of postgres.js.
   Your `DATABASE_URL` must be a Neon database.
2. **`nodejs_compat`** is required (for `node:crypto`). `node:dns` is unavailable,
   so the SSRF guard degrades to **hostname-only** checks (literal private IPs and
   `localhost` are still blocked; a DNS name resolving to a private IP cannot be
   detected on Workers). Keep an allowlist in front of `http.request` if this matters.

```bash
# wrangler.toml sets main = src/entry/cloudflare.ts, nodejs_compat, DB_DRIVER=neon
wrangler secret put DATABASE_URL          # Neon connection string
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put QSTASH_TOKEN
wrangler secret put QSTASH_CURRENT_SIGNING_KEY   # verifies inbound /engine requests
wrangler secret put QSTASH_NEXT_SIGNING_KEY
wrangler secret put CREDENTIAL_ENC_KEY
wrangler secret put INTERNAL_SECRET
wrangler deploy
```

Verify `@upstash/redis` and `@upstash/qstash` (both HTTP-based — good on Workers)
and confirm `postgres.js` is not bundled (it shouldn't be, with `DB_DRIVER=neon`).

---

## After deploy (any target)
1. `curl https://<host>/health` → `{ status: "ok" }`
2. Point QStash / schedules at `ENGINE_URL` and `PUBLIC_BASE_URL`.
3. Run the walkthrough in [SETUP.md §4](../SETUP.md) with your API key.
