# Inputs Needed From You

Everything in M1–M7 is built and tested, and the whole thing runs locally with **zero external services** (`DISPATCH_MODE=local`). To take it to production and make a few product calls, I need decisions and credentials from you. Grouped by "must decide before prod" vs "nice to decide soon".

---

## A. Accounts & secrets to provision (for production)

None of these are needed for local dev. Provision them when you deploy.

| Service | Why | Env var(s) |
|---|---|---|
| **Neon** (or any Postgres) | Definitions, runs, events, credentials, subscriptions | `DATABASE_URL` |
| **Upstash Redis** | Hot state (idempotency, locks, schedule ids) | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| **Upstash QStash** | Durable execution + schedules (`DISPATCH_MODE=qstash`) | `QSTASH_TOKEN` |
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

### 1. Authentication model  🔴 blocking for prod
Right now every authed endpoint reads a plaintext **`x-owner-id` header** — a placeholder, **not** real auth. Before exposing this, pick one:
- **API keys** per owner (hashed, looked up server-side) — simplest for machine-to-machine.
- **JWT** (verify a signed token, derive `ownerId` from claims) — fits if your apps already issue tokens.
- Delegate to a gateway (e.g. your existing auth) that injects a trusted owner id.

Tell me which, and I'll replace `src/http/middleware/auth.ts`.

### 2. Credential encryption key custody  🔴 blocking for prod
Env var is fine to start, but decide: plain env, or a KMS (AWS KMS / GCP KMS / Vault)? Affects rotation strategy. Right now it's a single symmetric key in `CREDENTIAL_ENC_KEY`.

### 3. Deployment target
Where does this run? It's framework-portable (Hono):
- **Vercel** — easiest with Upstash; Node runtime.
- **Cloudflare Workers** — cheapest, but check `node:*` usage (crypto/dns) in the SSRF guard.
- **A Node host** (Railway/Fly/render) — no caveats.

This determines the adapter entry point and how `PUBLIC_BASE_URL` is set.

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
