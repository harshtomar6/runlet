# Setup Guide

How to run the automations platform locally (no infra) and in production, plus an end-to-end API walkthrough.

- Architecture & rationale: [DESIGN.md](./DESIGN.md)
- Deployment targets (Node/Railway, Vercel, Cloudflare): [docs/DEPLOY.md](./docs/DEPLOY.md)
- Decisions/credentials I need from you: [docs/INPUTS_NEEDED.md](./docs/INPUTS_NEEDED.md)

---

## Prerequisites
- Node ≥ 20 (developed on 26)
- pnpm 9

```bash
pnpm install
```

---

## 1. Local development (zero external services)

The default `DISPATCH_MODE=local` runs the interpreter inline — no Postgres, Redis, or QStash required. Great for building nodes and trying flows.

```bash
pnpm typecheck     # tsc --noEmit
pnpm test          # interpreter, triggers, runs, validation, loop/jsonata (node:test)
pnpm demo          # runs a sample drip workflow through the interpreter, prints events
pnpm dev           # boots the HTTP API on :3000
```

Health check and node catalog work with no config:

```bash
curl localhost:3000/health
curl localhost:3000/node-types            # 11 node types with JSON Schemas
```

### Full API with zero infra

`DISPATCH_MODE` controls *execution*; storage is separate. The workflow CRUD/runs
endpoints persist through the store, which defaults to Postgres. To run the
**entire API with no Postgres/Redis**, use the in-memory store + the dev auth bypass:

```bash
STORE=memory AUTH_DEV_OWNER=dev pnpm dev
```

Now `POST /workflows`, `/execute`, `/runs`, etc. all work in-process. Data is
**non-persistent** (lost on restart) — dev/trying-it-out only. Then walk through §4
(the `x-owner-id` header is ignored while `AUTH_DEV_OWNER` is set).

> For a persistent local API instead, set `DATABASE_URL` + Upstash Redis (below), keep `STORE=postgres` and `DISPATCH_MODE=local`.

---

## 2. Provision services (production)

Copy the template and fill it in:

```bash
cp .env.example .env
```

1. **Postgres (Neon)** → set `DATABASE_URL`, then create tables:
   ```bash
   pnpm db:migrate         # applies drizzle/*.sql
   ```
2. **Upstash Redis** → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
3. **Upstash QStash** → `QSTASH_TOKEN`, and set `DISPATCH_MODE=qstash`.
4. **Public URL** → deploy (below), then set `PUBLIC_BASE_URL=https://your-app` and `ENGINE_URL=https://your-app/engine`.
5. **Generate secrets**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # CREDENTIAL_ENC_KEY
   ```
   Set `INTERNAL_SECRET` (schedule ticks) and optionally `WEBHOOK_SECRET` (HMAC on /hooks).
6. **Optional**: `RESEND_API_KEY`+`EMAIL_FROM` (real email), `SLACK_ALERT_WEBHOOK` (failure alerts), `AXIOM_TOKEN`+`AXIOM_DATASET` (logs).

See [docs/INPUTS_NEEDED.md](./docs/INPUTS_NEEDED.md) for the full list and the blocking decisions (auth, key custody, deploy target).

---

## 3. Deploy

The app is a portable Hono server with entry points for **Node/Railway**, **Vercel**, and **Cloudflare Workers** — see **[docs/DEPLOY.md](./docs/DEPLOY.md)** for per-target steps. In all cases:
- Point QStash at `ENGINE_URL` (`https://your-app/engine`) — this is the durable engine endpoint.
- Ensure `PUBLIC_BASE_URL` is reachable by QStash so schedule ticks hit `/triggers/tick/:id`.
- In `qstash` mode, runs are durable (survive restarts); schedules fire via QStash cron.

> Auth is via API keys (`Authorization: Bearer <key>`); mint with `pnpm create-api-key`. Never set `AUTH_DEV_OWNER` in production.

---

## 4. End-to-end walkthrough (API)

Authed calls send `Authorization: Bearer <api-key>`. Mint one first (or set `AUTH_DEV_OWNER` for local):

```bash
pnpm create-api-key --owner acme --name "walkthrough"   # prints ak_... once
export KEY=ak_...
```

Then build the "install → 7-day drip" from DESIGN.

**a. (Optional) store a Resend credential**
```bash
curl -X POST localhost:3000/credentials -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"type":"resend","secret":{"apiKey":"re_..."}}'
# → { data: { id: "<credentialId>", type: "resend" } }
```

**b. Create a workflow** (event-triggered; two emails with a wait — extend to 7)
```bash
curl -X POST localhost:3000/workflows -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{
    "name": "install-drip",
    "trigger": { "type": "event", "eventType": "app.installed" },
    "nodes": [
      { "id": "t",  "type": "trigger.event", "params": { "eventType": "app.installed" } },
      { "id": "e1", "type": "email.send",   "params": { "to": "{{ trigger.email }}", "templateId": "day-1" } },
      { "id": "w",  "type": "control.wait",  "params": { "duration": "1d" } },
      { "id": "e2", "type": "email.send",   "params": { "to": "{{ trigger.email }}", "templateId": "day-2" } }
    ],
    "edges": [
      { "from": {"nodeId":"t","port":"out"},      "to": {"nodeId":"e1","port":"in"} },
      { "from": {"nodeId":"e1","port":"success"}, "to": {"nodeId":"w","port":"in"} },
      { "from": {"nodeId":"w","port":"out"},      "to": {"nodeId":"e2","port":"in"} }
    ]
  }'
# → { data: { workflow: {id: "<workflowId>"}, version: {id: "<versionId>"} } }
```

**c. Validate & activate**
```bash
curl -X POST localhost:3000/workflows/<workflowId>/validate -H "authorization: Bearer $KEY"    # → { "data": { "ok": true, "errors": [] } }
curl -X POST localhost:3000/workflows/<workflowId>/activate -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"versionId":"<versionId>"}'
```

**d. Subscribe the event → workflow, then send an event**
```bash
curl -X POST localhost:3000/subscriptions -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"eventType":"app.installed","workflowId":"<workflowId>"}'

curl -X POST localhost:3000/events -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"type":"app.installed","payload":{"email":"user@example.com"}}'
# → { data: { triggered: [ { workflowId, runId } ] } }
```
(Or fire directly: `POST /hooks/<workflowId>`, or run manually: `POST /workflows/<workflowId>/execute` with `{"input":{...}}`.)

**e. Observe**
```bash
curl 'localhost:3000/runs?workflowId=<workflowId>' -H "authorization: Bearer $KEY"   # summaries + stepCount
curl localhost:3000/runs/<runId> -H "authorization: Bearer $KEY"              # run + per-node timeline
curl 'localhost:3000/metrics?workflowId=<workflowId>' -H "authorization: Bearer $KEY"
```

**f. Test a single node** (n8n-style)
```bash
curl -X POST localhost:3000/workflows/<workflowId>/test-node -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"nodeId":"e1","sampleInput":{"email":"test@example.com"}}'
```

---

## 5. Adding a new node type

1. Create/extend a file under `src/nodes/catalog/`, export a `defineNode({...})` with `inputSchema` (zod), `outputs`, and `execute`.
2. Register it in `src/nodes/catalog/index.ts`.
3. It's instantly in `GET /node-types` (schema for UIs) and usable in any workflow — no other changes.

---

## 6. Production checklist
- [ ] `AUTH_DEV_OWNER` **unset**; API keys minted per owner (`pnpm create-api-key`)
- [ ] `DISPATCH_MODE=qstash`, `QSTASH_TOKEN`, `PUBLIC_BASE_URL`, `ENGINE_URL` set
- [ ] `pnpm db:migrate` run against prod Postgres
- [ ] `CREDENTIAL_ENC_KEY` stored securely (KMS?) and backed up
- [ ] `INTERNAL_SECRET` + `WEBHOOK_SECRET` set
- [ ] Slack/Axiom wired for alerts + logs
- [ ] Loop caps / rate limits reviewed for cost
