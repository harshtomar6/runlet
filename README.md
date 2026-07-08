# app-automations

A headless, n8n-style workflow automation engine built on **Upstash Workflow** (durable execution over QStash). Workflows are **data** (a graph of nodes) interpreted by a single generic engine, with **UI-agnostic APIs** so any front-end can build, run, and observe automations.

- Cheap, serverless, no infra to manage (pay-per-step).
- Extensible via a **node registry** — add a node type, and it's available to every UI and every workflow.
- Swappable storage layer (Postgres + Redis defaults) behind narrow ports.

📄 See **[DESIGN.md](./DESIGN.md)** for the full architecture and build spec.

> Status: design phase. Implementation not started.
