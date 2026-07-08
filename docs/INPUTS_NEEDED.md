# Inputs Needed From You

Everything in M1–M7 is built and tested, and the whole thing runs locally with **zero external services** (`DISPATCH_MODE=local`). To take it to production and make a few product calls, I need decisions and credentials from you. Grouped by "must decide before prod" vs "nice to decide soon".

---

## A. Accounts & secrets to provision (for production)

None of these are needed for local dev. Provision them when you deploy.

| Service | Why | Env var(s) |
|---|---|---|
| **Neon** (or any Postgres) | Definitions, runs, events, credentials, subscriptions | `DATABASE_URL` |
| **Upstash Redis** | Hot state (idempotency, locks, schedule ids) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Upstash QStash** | Durable execution + schedules (`DISPATCH_MODE=qstash`) | `QSTASH_TOKEN` (publish); `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` (verify inbound `/engine` requests — required in prod qstash mode) |
| **Resend** (optional) | Real email sending; without it `email.send` is a dry-run | `RESEND_API_KEY`, `EMAIL_FROM` |
| **Slack incoming webhook** (optional) | Failure alerts | `SLACK_ALERT_WEBHOOK` |
| **Axiom** (optional) | Ship structured logs | `AXIOM_TOKEN`, `AXIOM_DATASET` |
| **A public URL** | QStash must reach `/engine` and schedule ticks | `PUBLIC_BASE_URL`, `ENGINE_URL` |

**Secrets to generate yourself:**
- `CREDENTIAL_ENC_KEY` — 32-byte base64 (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`). **Losing/rotating this makes stored credentials undecryptable.** Decide where it lives (env vs a KMS).
- `INTERNAL_SECRET` — guards `/triggers/tick/*` (schedule ticks). Any long random string.
- `WEBHOOK_SECRET` — optional; when set, `/hooks/:id` requires an HMAC `x-signature`.

---

## B. Decisions needed before production

### 1. Authentication model  ✅ DONE — API keys
Implemented: `Authorization: Bearer <key>` (or `x-api-key`), SHA-256-hashed at rest, owner-scoped. Manage via `POST/GET/DELETE /api-keys`; bootstrap with `pnpm create-api-key --owner <id> --name <label>`. Dev bypass: `AUTH_DEV_OWNER` (never in prod). Remaining optional follow-ups if you want them: key expiry, scopes/permissions, `lastUsedAt` tracking.

### 2. Credential encryption key custody  🔴 blocking for prod
Env var is fine to start, but decide: plain env, or a KMS (AWS KMS / GCP KMS / Vault)? Affects rotation strategy. Right now it's a single symmetric key in `CREDENTIAL_ENC_KEY`.

### 3. Deployment target  ✅ DONE — pick any, all wired
Entry points + config exist for **Node/Railway** (`Dockerfile`, `pnpm start`), **Vercel** (`api/index.ts` + `vercel.json`), and **Cloudflare Workers** (`wrangler.toml`, `DB_DRIVER=neon`). See [DEPLOY.md](./DEPLOY.md). You just choose one and set env vars. Cloudflare is marked experimental (needs a Neon DB; SSRF guard degrades to hostname-only without `node:dns`).

---

## C. Product decisions (can defer, but shape the roadmap)

### 4. Expression ergonomics
Expressions are **JSONata** inside `{{ }}`. Good for power users; a bit unfamiliar. Do you want a friendlier surface for the UI (a field picker / simple `a.b.c` mode) on top, or is raw JSONata fine?

### 5. `RunEvent` retention
The `run_events` table is the highest-volume table (one row per node execution). Decide a policy:
- Keep everything in Postgres (simplest; grows).
- Hot window in Postgres (e.g. 30 days) → cold to Axiom/object storage.
- Ship all events to Axiom and keep Postgres lean.

### 6. Which deferred nodes do you actually want? (from M7)
Not built yet — tell me which are worth doing:
- **`control.switch`** (multi-way branch) — needs a small change to allow dynamic output ports.
- **Explicit `merge`/join** — today convergent edges run the target once (first-arrival); a real "wait for all inbound" join is more work.
- **`data.code`** (arbitrary JS) — needs a real sandbox (`isolated-vm`/QuickJS + native deps). Security-sensitive; only if you need it.
- **`splitInBatches`** — batch iteration over arrays.

### 7. Human-in-the-loop (`waitForEvent`)
Upstash supports pausing a run until an external event/approval. Do any of your automations need approvals/waits-for-callback? If so I'll add a `wait.forEvent` node.

### 8. UI plans
The API is headless and complete for building UIs. Are you building the builder UI yourself, or should I scaffold a reference one? (Not required — just changes what I do next.)

---

## D. What I recommend as defaults (if you don't want to decide now)
- Auth: **API keys** (simplest, secure enough for M2M).
- Deploy: **Vercel + Upstash** (best-integrated, matches the cost analysis).
- Retention: **30-day hot in Postgres**, everything mirrored to Axiom once you turn Axiom on.
- Deferred nodes: build **`control.switch`** + **`splitInBatches`** first (common, low-risk); skip `data.code` unless a concrete need appears.

Reply with anything in **B** (blocking) and I'll wire it up; **C/D** we can iterate on.
