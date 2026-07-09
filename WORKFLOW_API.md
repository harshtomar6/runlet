# Workflow Automation API — Build Reference

> **Purpose of this document.** This is a complete, self-contained reference to the
> REST API and node catalog of this workflow-automation engine. It is written so
> that an AI assistant can read it once and then **translate a natural-language
> request into a valid workflow JSON and the API calls needed to create, activate,
> and run it** — with no other knowledge of the codebase.
>
> If you are an AI building a workflow from a user's request, read
> [§1 Mental model](#1-mental-model), [§4 Workflow-as-data](#4-the-workflow-object-workflow-as-data),
> [§5 Expressions](#5-expression-language), and [§8 Node catalog](#8-node-catalog),
> then follow the recipe in [§9 End-to-end recipes](#9-end-to-end-recipes).

---

## Table of contents

1. [Mental model](#1-mental-model)
2. [Base URL, auth & conventions](#2-base-url-auth--conventions)
3. [Response envelope & errors](#3-response-envelope--errors)
4. [The workflow object (workflow-as-data)](#4-the-workflow-object-workflow-as-data)
5. [Expression language](#5-expression-language)
6. [How a run executes (data flow)](#6-how-a-run-executes-data-flow)
7. [REST endpoints](#7-rest-endpoints)
8. [Node catalog](#8-node-catalog)
9. [End-to-end recipes](#9-end-to-end-recipes)
10. [Credentials reference](#10-credentials-reference)
11. [Validation rules & gotchas](#11-validation-rules--gotchas)

---

## 1. Mental model

A **workflow** is a directed graph, stored as data (JSON). It is n8n-like:

- **Nodes** are the steps. Each node has a globally unique `id` (you choose it),
  a `type` (from the catalog, e.g. `http.request`), and a `params` object.
- **Edges** connect a source node's **output port** to a target node's input.
  Ports are named strings — e.g. an action node exposes `success` / `error`, an
  `control.if` exposes `true` / `false`.
- Exactly **one node is a trigger** (`trigger.*`). It's the entry point; its
  `type` must match the workflow's `trigger.type`.
- Nodes reference the output of upstream nodes using **`{{ expressions }}`**
  (JSONata), e.g. `{{ check.status }}` reads the `status` field of the node whose
  `id` is `check`.

**Versioning:** a workflow is a container with `status` (`draft`/`active`/`disabled`).
Its nodes/edges live in immutable **versions**. Creating a workflow makes version 1;
`PUT` creates a new version. You must **activate** a version before schedule/webhook/
event triggers fire (manual `execute` works on the latest version without activation
in most setups — see [§7.3](#73-run-a-workflow)).

**Node kinds** (`kind` field): `trigger`, `action`, `control`, `wait`.
**Node apps** (`app` field): integration grouping (`ai`, `email`, `slack`, `http`,
`control`, `data`, `state`, `util`, `trigger`).

---

## 2. Base URL, auth & conventions

- **Base URL:** the deployed service root. When you fetch this document from
  `/llms.txt`, the concrete base URL for that deployment is stated on the **first
  line**; use it verbatim. Otherwise it's your own service root (e.g.
  `http://localhost:3000` in dev).
- **Content type:** `application/json` for all request bodies.
- **Auth:** every endpoint except `/`, `/health`, `/node-types`, `/hooks/*` requires
  an **API key**. Send it as either header:
  - `Authorization: Bearer <key>`  *(preferred)*
  - `x-api-key: <key>`
- The API key resolves to an **owner id**; every object you create is scoped to that
  owner and is invisible to others (multi-tenant isolation). You never pass an owner
  id explicitly — it comes from the key.
- **Dev bypass:** if the server has `AUTH_DEV_OWNER` set, auth is skipped and all
  requests act as that owner. (Forbidden in production.)

### Trigger-time auth (special cases)

| Entry point | Auth |
|---|---|
| `POST /hooks/:workflowId` (inbound webhook) | **Public.** If `WEBHOOK_SECRET` is set, requires header `x-signature` = HMAC-SHA256 of the raw body. In production an unsigned hook is rejected. |
| `POST /triggers/tick/:workflowId` (schedule tick) | Internal only. Requires header `x-internal-secret: <INTERNAL_SECRET>`. |

---

## 3. Response envelope & errors

**Every** JSON response uses one envelope:

```json
{
  "data": <any> | null,
  "error": null | { "code": "string", "message": "string", "details": any | null },
  "meta": { "requestId": "string", "...": "endpoint-specific (e.g. cursor)" }
}
```

- **Success:** `data` is populated, `error` is `null`. HTTP status is `200`, `201`
  (created), or `202` (accepted / run started asynchronously).
- **Failure:** `data` is `null`, `error` is populated.

Common error codes:

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `validation_error` / `invalid_json` / `invalid_status` | Bad request body or query. `details` often carries the Zod field errors. |
| 401 | `unauthorized` / `invalid_api_key` / `invalid_signature` | Missing/bad API key or webhook signature. |
| 404 | `not_found` | Object doesn't exist (or isn't yours). |
| 409 | `conflict` | Version race / concurrent update. |
| 429 | `rate_limited` | Event/webhook rate cap exceeded. |
| 503 | `qstash_unset` / `webhook_secret_unset` / `internal_secret_unset` | A required server secret isn't configured for that operation. |
| 500 | `internal_error` | Unhandled server error. |

---

## 4. The workflow object (workflow-as-data)

A workflow you `POST` to `/workflows` has this shape:

```jsonc
{
  "name": "string, required",
  "trigger": {
    "type": "webhook | schedule | event | manual",   // required
    "eventType": "string",   // required iff type === "event"
    "cron": "string"         // required iff type === "schedule", e.g. "*/5 * * * *"
  },
  "nodes": [
    {
      "id": "string, unique within the workflow",    // you choose; used in expressions
      "type": "catalog node type, e.g. http.request",
      "params": { /* node-specific; see §8. May contain {{ expressions }} */ },
      "position": { "x": 0, "y": 0 }   // optional; UI-only, ignored by the engine
    }
  ],
  "edges": [
    {
      "from": { "nodeId": "source-node-id", "port": "output-port-name" },
      "to":   { "nodeId": "target-node-id", "port": "in" }   // target port is conventional; any string
    }
  ]
}
```

### Rules

- **Exactly one trigger node**, and its `type` must equal `trigger.<trigger.type>`.
  (e.g. `trigger.type: "schedule"` ⇒ the trigger node's `type` must be
  `trigger.schedule`.)
- The trigger node's single output port is `out`. Wire it to the first real step.
- Every non-trigger node must be **reachable from the trigger** (no orphans).
- **No structural cycles.** Looping is done with the `control.loop` node, not by
  drawing an edge back — that node's `each`/`done` ports iterate at runtime and are
  not a graph cycle.
- `from.port` **must be a real output port** of the source node (see each node's
  `outputs` in §8). `to.port` is conventionally `"in"` and is not validated.
- Nodes not connected to anything downstream simply end that branch.

The `to.port` value is not meaningful to the engine (a node has one logical input);
use `"in"` by convention.

---

## 5. Expression language

Any string param may contain **JSONata** expressions inside `{{ ... }}`. They are
resolved just before a node executes, against a **scope** built from everything
produced so far.

### The scope

```jsonc
{
  "trigger": <the trigger payload / input to this run>,
  "<nodeId>": <the data output of that node>,   // one entry per already-executed node
  "loop": { "index": <number> }                 // only inside a control.loop body
}
```

So to read the HTTP status from a node with `id: "check"`, write `{{ check.status }}`.
To read a field from the triggering webhook body: `{{ trigger.user.email }}`.

### Resolution rules

- **`"{{ expr }}"` as the *entire* string** → replaced by the evaluated value with
  its real type (number, boolean, object, array…). e.g. `"{{ check.status != 200 }}"`
  becomes a real boolean.
- **`"hi {{ trigger.name }}"`** (embedded) → string interpolation; `null`/`undefined`
  render as empty string.
- **Objects and arrays** are resolved deeply (every string leaf is processed).
- **Plain values** (no `{{ }}`) pass through unchanged.
- A missing path yields `undefined` (not an error). A syntax/eval error throws
  `ExpressionError` and fails the node. Each expression has a 1s CPU budget.

### Handy JSONata snippets

| Goal | Expression |
|---|---|
| Field of a node output | `{{ check.body.items }}` |
| Comparison → boolean | `{{ check.status >= 400 }}` |
| String concat | `{{ "Order " & trigger.orderId & " shipped" }}` |
| Ternary/if | `{{ trigger.vip ? "priority" : "normal" }}` |
| Array length | `{{ $count(check.body.items) }}` |
| Current loop index | `{{ loop.index }}` |

---

## 6. How a run executes (data flow)

1. The engine finds the trigger node and seeds `outputs[triggerNodeId] = <trigger payload>`.
2. It walks edges from the trigger's `out` port.
3. For each node it: resolves `params` expressions against the scope → validates
   against the node's input schema → runs the node → stores `outputs[nodeId] = data`.
4. The node returns a **chosen output port**; the engine follows only edges leaving
   that port. (e.g. `control.if` returns `true` or `false` and only that branch runs.)
5. Convergent edges (two branches into one node) run the target **once**
   (first-arrival). There is no explicit join/merge node yet.

Execution is **durable**: each node is a checkpointed step. In `qstash` dispatch mode,
long waits (`control.wait`, `control.approval`) suspend and resume across time without
re-running earlier steps. In `local` mode everything runs inline and waits are
effectively immediate (approvals auto-approve).

Observability: each run emits events (`run.started`, `node.started`, `node.executed`,
`node.failed`, `run.succeeded`, `run.failed`) readable at `GET /runs/:id/events`.

---

## 7. REST endpoints

Legend: 🔒 = requires API key. Request/response bodies show the meaningful part of
`data`; the full envelope (§3) always wraps it.

### 7.1 Catalog (public)

#### `GET /node-types`
List every node type (flat). Add `?grouped=true` to group by `app` (integration).
Use this to discover the exact schema/ports of any node at runtime.

- **Response `data`** (flat): array of catalog entries:
  ```jsonc
  {
    "type": "http.request",
    "app": "http",
    "kind": "action",
    "category": "HTTP",
    "label": "HTTP Request",
    "description": "Makes an outbound HTTP request.",
    "outputs": ["success", "error"],
    "credentials": [],                 // required credential types
    "inputSchema": { /* JSON Schema of params */ }
  }
  ```
- **Grouped** (`?grouped=true`): `[{ app, label, nodes: [entry...] }]`.

#### `GET /node-types/:type`
One catalog entry (e.g. `GET /node-types/ai.complete`). `404` if unknown.

---

### 7.2 Workflows 🔒

#### `POST /workflows` → `201`
Create a workflow (as version 1, `status: "draft"`).
- **Body:** the [workflow object](#4-the-workflow-object-workflow-as-data)
  (`name`, `trigger`, `nodes`, `edges`; `nodes`/`edges` default to `[]`).
- **Response `data`:** `{ workflow, version }` — the created
  `Workflow` `{ id, ownerId, name, status, activeVersionId, trigger, createdAt, updatedAt }`
  **and** its first `WorkflowVersion` `{ id, workflowId, version, nodes, edges, createdAt }`.
  Grab `data.workflow.id` and `data.version.id` for the activate step.

#### `GET /workflows`
List workflows. Query: `status` (`draft|active|disabled`), `q` (name search),
`limit` (≤100, default 50), `cursor` (pagination — pass back `meta.cursor`).

#### `GET /workflows/:id`
Get one workflow (with its current definition).

#### `PUT /workflows/:id` → `201`
Replace nodes/edges (and optionally `name`/`trigger`) — **creates a new version**.
- **Body:** `{ name?, trigger?, nodes: [...], edges: [...] }` (`nodes` & `edges` required).
- **Response `data`:** the new `WorkflowVersion` `{ id, workflowId, version, nodes, edges, createdAt }`.

#### `DELETE /workflows/:id`
Delete the workflow. `data: { deleted: true }`.

#### `GET /workflows/:id/versions`
List versions (newest first). Paginated (`limit`, `cursor`).

#### `POST /workflows/:id/validate`
Structurally validate (optionally `?versionId=`). **Do this before activating.**
- **Response `data`:** `{ ok: boolean, errors: [{ code, message, nodeId? }] }`.
  See [§11](#11-validation-rules--gotchas) for codes.

#### `POST /workflows/:id/activate`
Mark a version active so schedule/webhook/event triggers fire.
- **Body:** `{ versionId: "..." }`.
- **Response `data`:** `{ activated: "<versionId>" }`.

#### `POST /workflows/:id/disable`
Stop triggers. `data: { disabled: true }`.

#### `POST /workflows/:id/test-node`
Run a **single node** in isolation (dry-run by default — no real side effects).
- **Body:** `{ nodeId: "...", sampleInput?: any, versionId?: "...", dryRun?: boolean }`.
  `dryRun` defaults to `true`; set `false` to allow real side effects.
- **Response `data`:** the node's `NodeOutcome` `{ data, port }`.

#### `POST /workflows/:id/execute` → `202`
Manually start a run. Uses the active version if one is set, otherwise the latest
version (so you can `execute` a draft without activating).
- **Body:** the trigger payload. Either send it raw (`{ "foo": 1 }`) or wrapped as
  `{ "input": { ... } }` — both work; `input` is unwrapped if present.
- **Response `data`:** `{ runId: "..." }`.

---

### 7.3 Runs & metrics 🔒

#### `GET /runs`
List runs. Query: `workflowId`, `status` (`running|succeeded|failed|cancelled`),
`limit` (≤500), `from`, `to` (ISO datetimes).

#### `GET /runs/:id`
Get one run: `{ id, ownerId, workflowId, versionId, status, trigger, workflowRunId, startedAt, finishedAt }`.

#### `GET /runs/:id/events`
Ordered run events (execution trace):
`[{ id, runId, nodeId?, type, input?, output?, error?, ts }]`.

#### `POST /runs/:id/cancel`
Cancel a running run. `data: { cancelled: true }`.

#### `GET /metrics`
Aggregate run metrics. Query: `workflowId?`, `window?` (e.g. `24h`).
- **Response `data`:** counts by status + `successRate` (0–1).

---

### 7.4 Events & subscriptions 🔒 (event-triggered workflows)

An **event** is an app-level signal (e.g. `user.signed_up`). A **subscription** binds
an `eventType` to a workflow, so posting that event starts the workflow.

#### `POST /events` → `202`
Emit an event; fans out to all subscribed active workflows for this owner.
Rate-limited to 120/min per `(owner, type)`.
- **Body:** `{ type: "user.signed_up", payload?: { ... } }`. The `payload` becomes
  the workflow's `trigger`.
- **Response `data`:** dispatch result (which workflows/runs were started).

#### `POST /subscriptions` → `201`
- **Body:** `{ eventType: "user.signed_up", workflowId: "..." }`.

#### `GET /subscriptions` — list. `DELETE /subscriptions/:id` — remove.

---

### 7.5 Credentials 🔒

Encrypted secrets referenced by nodes via `params.credentialId`. **Write-only** —
secret values are never returned.

#### `POST /credentials` → `201`
- **Body:** `{ type: "resend | slack | smtp | openrouter | ...", secret: { ...provider-specific } }`.
  See [§10](#10-credentials-reference) for the `secret` shape per type.
- **Response `data`:** `{ id, type }`. Use `id` as a node's `credentialId`.

#### `GET /credentials` — list metadata `{ id, type, createdAt }` (no secrets).
#### `DELETE /credentials/:id` — remove (owner-scoped; `404` if not yours).

---

### 7.6 API keys 🔒

Manage your own keys (authed by an existing key; bootstrap the first with the
server's `pnpm create-api-key`).

- `POST /api-keys` — Body `{ name }`. **Returns the raw `key` exactly once**:
  `data: { id, name, prefix, key }`.
- `GET /api-keys` — list metadata (no secret).
- `DELETE /api-keys/:id` — revoke. `data: { revoked: true }`.

---

### 7.7 Approvals 🔒 (human-in-the-loop delivery)

Resume a run suspended on a `control.approval` node (or an `ai.agent` tool awaiting
approval).

#### `POST /approvals`
- **Body:** `{ eventId: "...", approved?: boolean (default true), data?: any }`.
  The `eventId` is announced by the waiting node (via alert/log) and is stable per
  wait point. `data` is fed back to the workflow/agent (e.g. revision feedback on a
  denial).
- In `local` dispatch mode the run already auto-approved, so
  `data: { delivered: false, note: ... }`. In `qstash` mode it delivers via QStash
  notify: `data: { delivered: true }`.

---

### 7.8 Trigger entry points

#### `POST /hooks/:workflowId` → `202`  *(public; see §2 for signature)*
Inbound webhook. The JSON body becomes the run's `trigger`. `data: { runId }`.

#### `POST /triggers/tick/:workflowId` → `202`  *(internal; `x-internal-secret`)*
Schedule tick — used by the scheduler; you normally don't call this directly.

#### `POST /slack/events`  *(public; Slack-signed)*
Slack Events API ingress. Slack calls this; you don't. Answers the setup
handshake and resumes runs waiting on `slack.waitForReply`. Register it as the
app's Event Subscription URL and set `SLACK_SIGNING_SECRET`.

#### `GET /health` / `GET /` — liveness / service banner (public).

---

## 8. Node catalog

Every node below is registered and executable. For each: its `type`, `app`,
`kind`, **output ports** (what you wire edges from), required **credentials**, and
its **params**. Params marked *(expr)* commonly hold `{{ expressions }}`.

> Tip: `GET /node-types/:type` returns the authoritative JSON Schema for any node's
> params at runtime.

### 8.1 Triggers (`app: trigger`) — exactly one per workflow

| Type | Output ports | Params | Notes |
|---|---|---|---|
| `trigger.manual` | `out` | *(none)* | Started via `POST /workflows/:id/execute`. |
| `trigger.webhook` | `out` | *(none)* | Started via `POST /hooks/:id`. Body → `trigger`. |
| `trigger.schedule` | `out` | `cron` (string, required) | Fires on cron. Must be activated. Match `trigger.type: "schedule"`. |
| `trigger.event` | `out` | `eventType` (string, required) | Fires on `POST /events`. Needs a subscription. |

### 8.2 HTTP (`app: http`)

**`http.request`** — Makes an outbound HTTP request. *(SSRF-protected.)*
- **Outputs:** `success`, `error`
- **Credentials:** none (put auth in `headers`)
- **Params:**
  | key | type | required | default |
  |---|---|---|---|
  | `method` | `GET|POST|PUT|PATCH|DELETE` | no | `GET` |
  | `url` | string *(expr)* | **yes** | — |
  | `headers` | object<string,string> *(expr)* | no | — |
  | `body` | any *(expr)* | no | — |
- **Output data:** `{ status: number, body: any }`.

### 8.3 Email (`app: email`)

**`email.send`** — Templated email via Resend.
- **Outputs:** `success`, `error` · **Credentials:** `resend`
- **Params:** `to` (string, req, *expr*), `templateId` (string, req), `vars` (object, *expr*), `credentialId` (string).
- Idempotent per step; output `{ id, dryRun }` or `{ skipped: true }`.

**`email.smtp`** — Email over SMTP (nodemailer).
- **Outputs:** `success`, `error` · **Credentials:** `smtp`
- **Params:** `to` (req, *expr*), `subject` (req, *expr*), `html` (*expr*), `text` (*expr*), `credentialId`.
- Output `{ messageId, dryRun }`.

### 8.4 Slack (`app: slack`)

**`slack.post`** — Post a message to a Slack channel. Supports Block Kit and threading.
- **Outputs:** `success`, `error` · **Auth:** an OAuth `connectionId` (preferred) or a webhook `credentialId`
- **Params:**
  | key | type | notes |
  |---|---|---|
  | `channel` | string *(expr)* | e.g. `"#alerts"` or a channel id |
  | `text` | string *(expr)* | message text (fallback/notification text when using `blocks`) |
  | `blocks` | array *(expr)* | Block Kit blocks for rich messages |
  | `threadTs` | string *(expr)* | reply in a thread — pass an upstream post's `ts` |
  | `connectionId` | string | an OAuth Slack connection (bot token → Web API). **Required for `ts`/threading.** |
  | `credentialId` | string | an incoming-webhook credential (no `ts`, no threading) |
- **Output:** `{ ok, ts?, channel?, dryRun }`. `ts` is the message id (= thread id) — only returned via a `connectionId`. To reply into the same thread later, pass `{{ <thisNodeId>.ts }}` as another `slack.post`'s `threadTs`.
- Provide `text`, `blocks`, or both.

**`slack.waitForReply`** — Pause until someone replies in a thread (durable).
- **Outputs:** `reply`, `timeout` · **Auth:** `connectionId` (same Slack connection)
- **Params:** `channel` (channel id — use `{{ post.channel }}`), `threadTs` (parent ts — use `{{ post.ts }}`), `connectionId` (req), `timeoutSec` (int, default 86400).
- On a reply → `reply` port with `{ eventId, reply: { text, user, ts, channel } }`; on timeout → `timeout`.
- Requires the Slack **Events API** pointed at `POST /slack/events` (with `SLACK_SIGNING_SECRET`) and `DISPATCH_MODE=qstash` to truly suspend (auto-resolves in local mode).

### 8.5 AI (`app: ai`) — all via OpenRouter

**`ai.complete`** — LLM completion (any OpenRouter model). Optional conversation memory.
- **Outputs:** `success`, `error` · **Credentials:** `openrouter`
- **Params:**
  | key | type | required | notes |
  |---|---|---|---|
  | `model` | string | **yes** | e.g. `anthropic/claude-sonnet-4` |
  | `prompt` | string *(expr)* | one of prompt/messages | user message |
  | `system` | string *(expr)* | no | system prompt |
  | `messages` | `[{role, content}]` | one of prompt/messages | full message list |
  | `memory` | `{ key: string, window?: number }` | no | persists turns across runs, owner-scoped by `key` |
  | `temperature` | number 0–2 | no | |
  | `maxTokens` | integer | no | |
  | `credentialId` | string | no | |
- **Output data:** `{ text, model, usage?, dryRun }`.

**`ai.image`** — Generate image(s).
- **Outputs:** `success`, `error` · **Credentials:** `openrouter`
- **Params:** `model` (req, e.g. `google/gemini-2.5-flash-image-preview`), `prompt` (req, *expr*), `credentialId`.
- Output `{ images: string[], model, dryRun }` (URLs or `data:` URLs).

**`ai.transcribe`** — Audio → text.
- **Outputs:** `success`, `error` · **Credentials:** `openrouter`
- **Params:** `model` (req), `audio` (base64 string, req), `format` (default `mp3`), `prompt?`, `credentialId`.
- Output `{ text, model, dryRun }`.

**`ai.tts`** — Text → speech.
- **Outputs:** `success`, `error` · **Credentials:** `openrouter`
- **Params:** `model` (req), `text` (req, *expr*), `voice?`, `format` (default `mp3`), `credentialId`.
- Output `{ audio: base64, format, model, dryRun }`.

**`ai.agent`** — Bounded tool-calling loop. The model may call **allowlisted catalog
nodes as tools** until it produces an answer. Durable (each round/tool call is
checkpointed); supports per-tool human approval.
- **Outputs:** `success`, `error` · **Credentials:** `openrouter`
- **Params:**
  | key | type | required | notes |
  |---|---|---|---|
  | `model` | string | **yes** | |
  | `prompt` | string *(expr)* | **yes** | the task |
  | `system` | string *(expr)* | no | |
  | `tools` | `[{ tool: string, credentialId?: string, requireApproval?: boolean }]` | no (default `[]`) | `tool` is a catalog node type the agent may call; set `requireApproval` to pause for a human before that tool runs |
  | `maxSteps` | integer 1–20 | no (default 6) | max LLM rounds |
  | `approvalTimeoutSec` | integer | no (default 86400) | wait budget per approval |
  | `credentialId` | string | no | |
- **Output data:** `{ text, steps, toolCalls: [{ tool, args, result, approved? }] }`.
- On a denied tool call, the human's `data` (from `POST /approvals`) is fed back to
  the model as the tool result so it revises and retries.

### 8.6 Control flow (`app: control`)

**`control.if`** — Branch on a boolean.
- **Outputs:** `true`, `false` · **Params:** `condition` (*expr*, required — resolves to truthy/falsy).
- Routes to `true` or `false`. Output `{ condition: boolean }`.

**`control.switch`** — Route to the first matching case.
- **Outputs:** `0`, `1`, `2`, `3`, `4`, `default`
- **Params:** `value` (*expr*), `cases` (`[{ equals: any }]`, ≤5). First case whose
  `equals === value` → port `"0".."4"`; else `default`. Output `{ value, matched }`.

**`control.filter`** — Continue only if truthy.
- **Outputs:** `out`, `stop` · **Params:** `condition` (*expr*).
- Truthy → `out`; falsy → `stop` (halts this branch). Output `{ pass: boolean }`.

**`control.loop`** — Repeat a branch a fixed number of times.
- **Outputs:** `each` (body, runs N times), `done` (after loop)
- **Params:** `times` (integer 1–1000, *expr*). Inside the `each` body, `{{ loop.index }}`
  is the 0-based iteration. Wire the repeated work off `each`; continue off `done`.

**`control.wait`** — Pause for a duration.
- **Outputs:** `out` · **Params:** `duration` (string, e.g. `30s`, `15m`, `2h`, `1d`, `1w`).
- Durable sleep in qstash mode.

**`control.approval`** — Pause for human approve/reject (durable).
- **Outputs:** `approved`, `rejected` · **Params:** `message?` (*expr*),
  `timeoutSec` (integer ≤ 2,592,000, default 86400).
- Announces a stable `eventId`; resumed by `POST /approvals { eventId, approved, data }`.
  Timeout → `rejected`. In local mode auto-approves. Output
  `{ eventId, approved, timedOut, decision }`.

### 8.7 Data (`app: data`)

**`data.set`** — Build an object from static values and expressions.
- **Outputs:** `out` · **Params:** `fields` (object *(expr)*, required). Output = the resolved `fields`.

**`data.transform`** — Output a single computed value.
- **Outputs:** `out` · **Params:** `value` (any *(expr)*). Output = the resolved value.
  Use to reshape upstream data, e.g. `value: "{{ { 'email': trigger.user.email, 'n': check.body.count } }}"`.

### 8.8 State (`app: state`) — shared state **across executions**

Backed by a KV store, **owner-scoped** (`${ownerId}:${key}`). This is how a scheduled
workflow remembers what it did on a previous run (dedup, counters, "do this once").

**`state.get`** — Read a value.
- **Outputs:** `out` · **Params:** `key` (string, req). Output `{ key, value }` (JSON-parsed, or `null`).

**`state.set`** — Write a value.
- **Outputs:** `out` · **Params:** `key` (req), `value` (any), `ttlSec?` (int). Output `{ key, ok: true }`.

**`state.setNX`** — Set only if absent (dedup / do-once).
- **Outputs:** `out` · **Params:** `key` (req), `value` (string, default `"1"`), `ttlSec` (int, default 86400).
- Output `{ key, set: boolean }` — `set:true` means *you* claimed it (first time);
  `set:false` means it already existed.

**`state.incr`** — Atomic counter.
- **Outputs:** `out` · **Params:** `key` (req), `ttlSec?` (int). Output `{ key, value: number }`.

**`state.delete`** — Delete a key.
- **Outputs:** `out` · **Params:** `key` (req). Output `{ key, deleted: true }`.

### 8.9 Utility (`app: util`)

**`util.log`** — Write to the run log (debugging); passes through.
- **Outputs:** `out` · **Params:** `message` (string, req, *expr*), `level` (`debug|info|warn|error`, default `info`).

---

## 9. End-to-end recipes

### 9.1 The build loop (do this for every workflow)

1. `POST /workflows` with the full graph → response `data` is
   `{ workflow, version }`. Keep `data.workflow.id` and `data.version.id`.
2. `POST /workflows/:id/validate` → ensure `data.ok === true`. Fix any `errors`.
3. `POST /workflows/:id/activate` with the `versionId` (needed for schedule/webhook/event).
4. Trigger it:
   - manual → `POST /workflows/:id/execute` with a payload,
   - webhook → `POST /hooks/:id`,
   - event → `POST /events`,
   - schedule → wait for the cron.
5. Observe: `GET /runs?workflowId=:id`, then `GET /runs/:runId/events`.

If a node needs a provider (Slack, email, OpenRouter), first
`POST /credentials` and put the returned `id` into that node's `params.credentialId`.

### 9.2 Recipe: Slack alert on webhook

> "When my webhook fires, post its message to Slack."

```jsonc
{
  "name": "webhook-to-slack",
  "trigger": { "type": "webhook" },
  "nodes": [
    { "id": "in",   "type": "trigger.webhook", "params": {} },
    { "id": "post", "type": "slack.post",
      "params": { "channel": "#alerts", "text": "{{ trigger.message }}", "credentialId": "<slack-cred-id>" } }
  ],
  "edges": [
    { "from": { "nodeId": "in", "port": "out" },      "to": { "nodeId": "post", "port": "in" } }
  ]
}
```

### 9.3 Recipe: Service monitor with de-duplicated alerts

> "Every minute, check a service. Alert Slack **only if I haven't already alerted**.
> When it recovers, reset so the next outage alerts again."

This is the canonical use of the `state.*` nodes. `state.setNX` gives the first
failure in the TTL window `set:true` (fire), later failures `set:false` (suppress);
recovery `state.delete`s the key.

```jsonc
{
  "name": "service-monitor",
  "trigger": { "type": "schedule", "cron": "*/1 * * * *" },
  "nodes": [
    { "id": "t",     "type": "trigger.schedule", "params": { "cron": "*/1 * * * *" } },
    { "id": "check", "type": "http.request",      "params": { "method": "GET", "url": "https://example.com/health" } },
    { "id": "down",  "type": "control.if",        "params": { "condition": "{{ check.status != 200 }}" } },
    { "id": "claim", "type": "state.setNX",       "params": { "key": "alert:example", "ttlSec": 3600 } },
    { "id": "first", "type": "control.if",        "params": { "condition": "{{ claim.set }}" } },
    { "id": "alert", "type": "slack.post",        "params": { "channel": "#alerts", "text": "🚨 example.com is down", "credentialId": "<slack-cred-id>" } },
    { "id": "reset", "type": "state.delete",      "params": { "key": "alert:example" } }
  ],
  "edges": [
    { "from": { "nodeId": "t",     "port": "out" },     "to": { "nodeId": "check", "port": "in" } },
    { "from": { "nodeId": "check", "port": "success" }, "to": { "nodeId": "down",  "port": "in" } },
    { "from": { "nodeId": "down",  "port": "true" },    "to": { "nodeId": "claim", "port": "in" } },
    { "from": { "nodeId": "down",  "port": "false" },   "to": { "nodeId": "reset", "port": "in" } },
    { "from": { "nodeId": "claim", "port": "out" },     "to": { "nodeId": "first", "port": "in" } },
    { "from": { "nodeId": "first", "port": "true" },    "to": { "nodeId": "alert", "port": "in" } }
  ]
}
```

### 9.4 Recipe: AI draft → human approval → send

> "Generate a message with AI, wait for me to approve or give feedback, then post it."

```jsonc
{
  "name": "ai-draft-approve-send",
  "trigger": { "type": "manual" },
  "nodes": [
    { "id": "start",  "type": "trigger.manual", "params": {} },
    { "id": "draft",  "type": "ai.complete",
      "params": { "model": "anthropic/claude-sonnet-4",
                  "prompt": "Write a launch announcement for: {{ trigger.topic }}",
                  "credentialId": "<openrouter-cred-id>" } },
    { "id": "ok",     "type": "control.approval",
      "params": { "message": "Approve this draft?", "timeoutSec": 86400 } },
    { "id": "send",   "type": "slack.post",
      "params": { "channel": "#announcements", "text": "{{ draft.text }}", "credentialId": "<slack-cred-id>" } }
  ],
  "edges": [
    { "from": { "nodeId": "start", "port": "out" },      "to": { "nodeId": "draft", "port": "in" } },
    { "from": { "nodeId": "draft", "port": "success" },  "to": { "nodeId": "ok",    "port": "in" } },
    { "from": { "nodeId": "ok",    "port": "approved" }, "to": { "nodeId": "send",  "port": "in" } }
  ]
}
```

Approve at runtime with `POST /approvals { "eventId": "<announced>", "approved": true }`.
(For a "draft → feedback → revise → resend" loop, use `ai.agent` with `slack.post` as
a `requireApproval` tool — a denial with `data` feeds your feedback back to the model.)

### 9.5 Recipe: Event fan-out (welcome sequence)

> "When a user signs up, wait a day, then email them."

1. Create the workflow with `trigger: { type: "event", eventType: "user.signed_up" }`,
   a `trigger.event` node (`params: { eventType: "user.signed_up" }`), a `control.wait`
   (`duration: "1d"`), and an `email.send`.
2. `POST /subscriptions { eventType: "user.signed_up", workflowId }`.
3. Activate. Then `POST /events { type: "user.signed_up", payload: { email: "a@b.com" } }`
   starts a run whose `trigger` is that payload — reference it as `{{ trigger.email }}`.

### 9.6 Recipe: Post to Slack, wait for a reply in the thread, continue

> "Post a question to Slack; when someone replies in that thread, act on their answer."

```jsonc
{
  "name": "slack-ask-and-wait",
  "trigger": { "type": "manual" },
  "nodes": [
    { "id": "start", "type": "trigger.manual", "params": {} },
    { "id": "ask",   "type": "slack.post",
      "params": { "channel": "#ops", "text": "Deploy now? reply yes/no", "connectionId": "<slack-connection-id>" } },
    { "id": "wait",  "type": "slack.waitForReply",
      "params": { "channel": "{{ ask.channel }}", "threadTs": "{{ ask.ts }}", "connectionId": "<slack-connection-id>", "timeoutSec": 3600 } },
    { "id": "ack",   "type": "slack.post",
      "params": { "channel": "{{ ask.channel }}", "threadTs": "{{ ask.ts }}", "text": "Got it: {{ wait.reply.text }}", "connectionId": "<slack-connection-id>" } }
  ],
  "edges": [
    { "from": { "nodeId": "start", "port": "out" },     "to": { "nodeId": "ask",  "port": "in" } },
    { "from": { "nodeId": "ask",   "port": "success" }, "to": { "nodeId": "wait", "port": "in" } },
    { "from": { "nodeId": "wait",  "port": "reply" },   "to": { "nodeId": "ack",  "port": "in" } }
  ]
}
```

`ask` returns `ts` + `channel` (Web API); `wait` suspends on that thread and resumes when someone replies, exposing `{{ wait.reply.text }}`. Needs the Slack Events API → `/slack/events` and `DISPATCH_MODE=qstash`.

---

## 10. Credentials reference

Create with `POST /credentials { type, secret }`, then set the returned `id` as a
node's `params.credentialId`. Secrets are encrypted and never returned. Without a
credential (or a server env fallback), provider nodes run as a **dry-run** (no real
side effect, `dryRun: true` in output).

| `type` | `secret` shape | Used by |
|---|---|---|
| `resend` | `{ "apiKey": "re_..." }` | `email.send` (fallback: `RESEND_API_KEY`) |
| `slack` | `{ "webhookUrl": "https://hooks.slack.com/..." }` | `slack.post` (webhook mode — no threading) |
| `smtp` | `{ "host", "port", "user", "pass", "from", "secure?" }` | `email.smtp` |
| `openrouter` | `{ "apiKey": "sk-or-..." }` | all `ai.*` (fallback: `OPENROUTER_API_KEY`) |

`http.request` needs no credential — put any auth token directly in `headers`
(e.g. `{ "Authorization": "Bearer ..." }`).

### OAuth connections

Some integrations use an **OAuth connection** instead of a pasted secret. The
owner links their account via `POST /oauth/:provider/start` → consent →
`GET /connections` lists them `{ id, provider, accountId, label, scopes }`. Set
that `id` as a node's **`connectionId`** (e.g. `slack.post` in Web-API mode gets
threading + `ts` this way). Connections are owner-scoped; tokens are never returned.

---

## 11. Validation rules & gotchas

`POST /workflows/:id/validate` returns `{ ok, errors: [{ code, message, nodeId? }] }`.
Error codes and how to fix them:

| `code` | Cause | Fix |
|---|---|---|
| `no_trigger` | No `trigger.*` node | Add exactly one trigger node. |
| `multiple_triggers` | >1 trigger node | Keep only one. |
| `trigger_mismatch` | Trigger node type ≠ `trigger.<workflow.trigger.type>` | Make them match (e.g. `schedule` ↔ `trigger.schedule`). |
| `unknown_node_type` | `type` not in catalog | Use a `type` from §8 / `GET /node-types`. |
| `missing_param` | A required param is absent from `params` | Add the key. A `{{ expr }}` value counts as present. |
| `duplicate_node_id` | Two nodes share an `id` | Make ids unique. |
| `dangling_edge` | Edge references a missing node | Fix `from.nodeId` / `to.nodeId`. |
| `invalid_output_port` | `from.port` isn't a real output of that node | Use a listed output port (§8). |
| `orphan_node` | Node unreachable from the trigger | Wire an edge into it. |
| `cycle` | A structural back-edge | Use `control.loop` for repetition, not a back-edge. |

**Notes for building correctly:**

- Validation checks *shape and wiring*, not expression values — a param may legitimately
  hold `{{ ... }}` instead of a literal, so it won't type-check runtime values.
- The **`from.port` must match** the source node's declared outputs exactly (case-sensitive):
  action/AI/email/slack/http → `success`|`error`; `control.if`/`filter` etc. as listed.
- Always route branch nodes' *both* meaningful ports if both matter; unrouted ports
  just end that path.
- To read data from an upstream node, use its **`id`** in the expression scope, e.g.
  node `id: "check"` → `{{ check.status }}`. The trigger payload is always `{{ trigger.* }}`.
- Set `credentialId` on any node whose `credentials` list is non-empty, or accept a
  dry-run.
```
