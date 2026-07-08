# app-automations

A headless, n8n-style workflow automation engine built on **Upstash Workflow** (durable execution over QStash). Workflows are **data** (a graph of nodes) interpreted by a single generic engine, with **UI-agnostic APIs** so any front-end can build, run, and observe automations.

- Cheap, serverless, no infra to manage (pay-per-step).
- Extensible via a **node registry** — add a node type, and it's available to every UI and every workflow.
- Swappable storage layer (Postgres + Redis defaults) behind narrow ports.

📄 **[DESIGN.md](./DESIGN.md)** — architecture · **[SETUP.md](./SETUP.md)** — run it · **[docs/DEPLOY.md](./docs/DEPLOY.md)** — deploy · **[docs/INPUTS_NEEDED.md](./docs/INPUTS_NEEDED.md)** — decisions

> Status: **M1–M8 implemented** — storage ports + adapters, workflow CRUD + versioning, node catalog, durable interpreter (JSONata + loops), triggers (webhooks/events/schedules), runs & metrics, test-node, credentials, SSRF-safe HTTP, **API-key auth**, and deploy targets for **Node/Railway, Vercel, Cloudflare**. Runs locally with **zero external services** (`DISPATCH_MODE=local`).

## Getting started

```bash
pnpm install
cp .env.example .env      # fill in DATABASE_URL / Upstash / enc key as needed
pnpm dev                  # boots on :3000 (health check needs no backing stores)
pnpm typecheck            # tsc --noEmit
pnpm db:generate          # generate SQL migrations from the Drizzle schema
```

The server boots without Postgres/Redis for the health check — adapters connect lazily on first use.

## Project structure

```
src/
  config/env.ts            # zod-validated environment
  domain/                  # storage-agnostic types + id generation
  ports/                   # WorkflowRepo, EventLog, CredentialStore, KVState interfaces
  storage/
    crypto.ts              # AES-256-GCM for credential secrets
    factory.ts             # adapter selection → the `store` singleton
    postgres/              # schema (Drizzle) + WorkflowRepo/EventLog/CredentialStore
    redis/                 # KVState (Upstash)
  http/                    # Hono app + routes (health)
  index.ts                 # entry point
```

## Roadmap

Milestones M1–M7 (defined in [DESIGN.md §17](./DESIGN.md#17-build-order-milestones)) are implemented. Remaining/deferred items (auth hardening, `control.switch`, explicit `merge`, `data.code` sandbox, `splitInBatches`) are tracked in [docs/INPUTS_NEEDED.md](./docs/INPUTS_NEEDED.md).
