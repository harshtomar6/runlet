# Runlet Copilot — Workflow-Authoring Agent (Scaffolding Spec)

> **Purpose.** Build **Runlet Copilot**: a Next.js chat app where a user describes an
> automation in natural language and an LLM (via **OpenRouter**) turns it into a
> working [Runlet](https://runlet.harshtomar.com) workflow — discovering nodes,
> drafting the graph, **validating and dry-running it against the engine**, repairing
> errors, and (on the user's confirmation) creating and activating it.
>
> This document is a **prompt/spec**: hand it to a coding agent (or follow it
> yourself) to scaffold the app. It is self-contained — every Runlet detail the
> agent needs is here or reachable via the engine's own `GET /llms.txt`.

---

## 0. The one principle that makes this work

**Do not one-shot workflow JSON.** Runlet is a closed feedback loop — use it:

```
understand intent
  → discover nodes/credentials (GET /node-types, /credentials)
  → draft { trigger, nodes, edges }
  → POST /workflows/validate         (structural + expression-syntax errors)
  → repair, repeat until ok
  → POST /workflows/dry-run           (simulate whole graph, no side effects)
  → repair on node.failed, repeat until ok
  → show the user the plan + dry-run outputs
  → [user confirms] POST /workflows → POST /workflows/:id/activate
  → optionally POST /workflows/:id/execute and read GET /runs/:id/events
```

The engine's `validate` errors and `dry-run` `node.failed` events are the reward
signal. The agent is a tool-using loop over these endpoints; the model's job is to
draft and repair, not to be perfect on the first try.

---

## 1. Tech stack

- **Next.js (App Router) + TypeScript + Tailwind.** Deploy on Vercel.
- **Vercel AI SDK (`ai`)** + **`@openrouter/ai-sdk-provider`** for a streaming,
  multi-step tool-calling agent loop (`streamText` with `tools` + `stopWhen`/`maxSteps`).
- **`zod`** for tool parameter schemas.
- All model + Runlet calls happen **server-side** (API route / server actions). No
  secret ever reaches the browser.

---

## 2. Environment variables (`.env.local`)

```bash
OPENROUTER_API_KEY=sk-or-...
# A strong tool-calling model on OpenRouter. Prefer the latest capable Claude
# (e.g. a current Claude Sonnet/Opus). Keep it configurable.
OPENROUTER_MODEL=anthropic/claude-sonnet-4
RUNLET_BASE_URL=https://runlet.harshtomar.com
RUNLET_API_KEY=ak_...            # a Runlet API key (server-only)
```

Optionally allow the user to supply their own Runlet base URL + key in the UI
(stored server-side per session) instead of a single env key — but start with env.

---

## 3. What you need to know about Runlet (the target engine)

Full reference is served live at **`${RUNLET_BASE_URL}/llms.txt`** — fetch it at
startup and put it in the system prompt (it includes the base URL, envelope, the
expression language, the full node catalog, recipes, and validation codes). Summary:

- **Auth:** every call except `/llms.txt`, `/node-types`, `/health` needs
  `Authorization: Bearer ${RUNLET_API_KEY}`.
- **Envelope:** every response is `{ data, error, meta }`. On success `data` is set
  and `error` is `null`; on failure `error = { code, message, details }`.
- **Workflow shape:**
  ```jsonc
  {
    "name": "string",
    "trigger": { "type": "webhook|schedule|event|manual", "cron?": "...", "eventType?": "..." },
    "nodes": [ { "id": "unique", "type": "catalog.type", "params": { /* may contain {{ expressions }} */ } } ],
    "edges": [ { "from": { "nodeId": "a", "port": "success" }, "to": { "nodeId": "b", "port": "in" } } ]
  }
  ```
- **Rules:** exactly one `trigger.*` node whose type matches `trigger.type`; every node
  reachable from the trigger; no cycles (use `control.loop`); `from.port` must be a real
  output port of the source node.
- **Expressions:** `{{ jsonata }}` against a scope of `{ trigger, <nodeId>: <output>, loop: { index } }`.
  e.g. `{{ trigger.email }}`, `{{ check.status != 200 }}`. Credential fields:
  `{{ $secret.<key> }}` inside an `http.request` (see `secretKeys`).
- **Endpoints the agent uses** (all under `${RUNLET_BASE_URL}`): see §5.

---

## 4. Project structure

```
runlet-copilot/
  app/
    page.tsx                 # chat UI (client)
    api/chat/route.ts        # POST — runs the agent loop (streamText + tools)
    api/actions.ts           # server actions: confirmActivate, confirmExecute (gated)
  lib/
    runlet.ts                # typed Runlet REST client (auth + envelope unwrap)
    tools.ts                 # AI SDK tools (zod params → runlet client)
    prompt.ts                # system prompt = operator rules + fetched /llms.txt
    model.ts                 # OpenRouter provider + model selection
  components/
    Chat.tsx, WorkflowPanel.tsx, RunPanel.tsx
  .env.local
```

---

## 5. `lib/runlet.ts` — typed REST client

A thin wrapper: injects auth, unwraps the `{ data, error }` envelope, throws a clean
error the agent can read. Implement one method per endpoint below.

```ts
const BASE = process.env.RUNLET_BASE_URL!;
const KEY = process.env.RUNLET_API_KEY!;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.data as T;
}

export const runlet = {
  llmsTxt: () => fetch(`${BASE}/llms.txt`).then((r) => r.text()),
  listNodeTypes: (grouped = false) => call("GET", `/node-types${grouped ? "?grouped=true" : ""}`),
  getNodeType: (type: string) => call("GET", `/node-types/${type}`),
  listCredentials: () => call("GET", "/credentials"),
  validate: (graph: unknown) => call("POST", "/workflows/validate", graph),
  dryRun: (graph: unknown) => call("POST", "/workflows/dry-run", graph),
  create: (wf: unknown) => call("POST", "/workflows", wf),
  update: (id: string, wf: unknown) => call("PUT", `/workflows/${id}`, wf),
  activate: (id: string, versionId: string) => call("POST", `/workflows/${id}/activate`, { versionId }),
  execute: (id: string, input?: unknown) => call("POST", `/workflows/${id}/execute`, { input }),
  getRun: (id: string) => call("GET", `/runs/${id}`),
  getRunEvents: (id: string) => call("GET", `/runs/${id}/events`),
};
```

Endpoint contracts (from Runlet):
- `GET /node-types` → `[{ type, app, kind, category, label, outputs, credentials, inputSchema (JSON Schema) }]`. `?grouped=true` groups by app.
- `GET /credentials` → `[{ id, type, secretKeys, createdAt }]` (**names only, no values** — use `secretKeys` to know what to reference as `{{ $secret.<key> }}`).
- `POST /workflows/validate` → `{ ok, errors: [{ code, message, nodeId? }] }`.
- `POST /workflows/dry-run` (body `{ trigger, nodes, edges, input? }`) → `{ ok, validation, outputs: { <nodeId>: data }, events, sleeps, error? }`.
- `POST /workflows` → `{ workflow: { id, ... }, version: { id, ... } }`.
- `POST /workflows/:id/activate` → `{ activated }`.
- `POST /workflows/:id/execute` → `{ runId }`.

---

## 6. `lib/tools.ts` — the agent's tools

Define AI-SDK tools; each `execute` calls `runlet`. Return the raw result to the model
(it reads errors and repairs). **`activate` and `execute` are the only tools with real
consequences — gate them behind explicit user confirmation (see §8/§9), don't let the
model call them autonomously.**

```ts
import { tool } from "ai";
import { z } from "zod";
import { runlet } from "./runlet";

const graphSchema = z.object({
  trigger: z.object({ type: z.enum(["webhook", "schedule", "event", "manual"]), cron: z.string().optional(), eventType: z.string().optional() }),
  nodes: z.array(z.object({ id: z.string(), type: z.string(), params: z.record(z.any()).default({}) })),
  edges: z.array(z.object({ from: z.object({ nodeId: z.string(), port: z.string() }), to: z.object({ nodeId: z.string(), port: z.string() }) })).default([]),
});

export const tools = {
  list_node_types: tool({ description: "List Runlet node types (grouped by app optional).",
    parameters: z.object({ grouped: z.boolean().optional() }),
    execute: ({ grouped }) => runlet.listNodeTypes(grouped) }),

  get_node_type: tool({ description: "Get one node type's full JSON Schema for its params + its output ports.",
    parameters: z.object({ type: z.string() }),
    execute: ({ type }) => runlet.getNodeType(type) }),

  list_credentials: tool({ description: "List the user's credentials (id, type, secretKeys — field names only).",
    parameters: z.object({}), execute: () => runlet.listCredentials() }),

  validate_workflow: tool({ description: "Validate a graph WITHOUT creating it. Returns { ok, errors }.",
    parameters: graphSchema, execute: (g) => runlet.validate(g) }),

  dry_run_workflow: tool({ description: "Simulate the whole graph (no side effects). Returns per-node outputs + errors.",
    parameters: graphSchema.extend({ input: z.any().optional() }), execute: (g) => runlet.dryRun(g) }),

  create_workflow: tool({ description: "Create a workflow as a draft. Returns { workflow, version }.",
    parameters: graphSchema.extend({ name: z.string() }), execute: (wf) => runlet.create(wf) }),
  // activate_workflow / execute_workflow: DO NOT expose to the model directly —
  // surface them as UI actions requiring the user's click (see §8).
};
```

> Only expose **read + validate + dry-run + create-draft** to the model. Keep
> **activate** and **execute** (real triggers/side effects) as human-confirmed UI actions.

---

## 7. `lib/prompt.ts` — the system prompt

```ts
import { runlet } from "./runlet";

export async function systemPrompt(): Promise<string> {
  const guide = await runlet.llmsTxt(); // the live Runlet build reference
  return `You are Runlet Copilot. You turn a user's plain-English automation request
into a working Runlet workflow by USING the Runlet API through your tools — never by
guessing.

Follow this loop every time:
1. Clarify the trigger and the steps if ambiguous (ask at most 1-2 tight questions).
2. Call get_node_type for EVERY node type you intend to use, to get its exact param
   JSON Schema and its real output ports. Never invent node types, params, or ports.
3. Call list_credentials to see what auth exists. Reference secrets as {{ $secret.<key> }}
   (http.request) or via a node's credentialId/connectionId. If a required credential
   or OAuth connection is MISSING, STOP and tell the user what to connect — do not invent ids.
4. Draft { name, trigger, nodes, edges }. Wire ports using the outputs from step 2
   (e.g. action nodes use "success"/"error"; control.if uses "true"/"false").
   Reference upstream data with {{ <nodeId>.<field> }} against the scope { trigger, <nodeId> }.
5. Call validate_workflow. If not ok, fix every error (codes explained in the guide) and re-validate.
6. Call dry_run_workflow with a realistic sample "input". If not ok, read the node.failed
   event + error, fix, and re-run. Use the returned per-node "outputs" to confirm your
   {{ }} references resolve to the shapes you expect.
7. When validate AND dry-run are ok, call create_workflow (draft) and present:
   the plan (nodes + wiring in plain English), the dry-run outputs, and the workflow id.
8. Tell the user they can ACTIVATE (to make triggers fire) or EXECUTE (to run once) via
   the buttons — you must NOT activate or execute yourself. Those have real effects.

Rules:
- Prefer connectionId (OAuth) over credentialId for Slack; put arbitrary API tokens in
  http.request via credentialId + {{ $secret.* }} (e.g. Telegram's token-in-URL).
- Keep node ids short and meaningful; exactly one trigger node matching trigger.type.
- If dry-run shows an http.request returning { dryRun: true }, that's expected (stubbed) —
  it confirms wiring, not the real API payload.
- Be concise with the user; do the API work via tools, not by pasting huge JSON unless asked.

--- RUNLET REFERENCE (authoritative) ---
${guide}`;
}
```

---

## 8. `app/api/chat/route.ts` — the loop

```ts
import { streamText } from "ai";
import { openrouter } from "@/lib/model";
import { tools } from "@/lib/tools";
import { systemPrompt } from "@/lib/prompt";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const result = streamText({
    model: openrouter(process.env.OPENROUTER_MODEL!),
    system: await systemPrompt(),
    messages,
    tools,
    maxSteps: 16, // allow the discover→draft→validate→dry-run→repair loop
  });
  return result.toDataStreamResponse();
}
```

`lib/model.ts`:
```ts
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
export const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });
```

**Activate/Execute** are separate server actions (`app/api/actions.ts`) invoked by UI
buttons, not by the model:
```ts
"use server";
export async function activate(id: string, versionId: string) { return runlet.activate(id, versionId); }
export async function executeOnce(id: string, input?: unknown) { return runlet.execute(id, input); }
```

---

## 9. UI (`app/page.tsx` + components)

- **Chat panel** (`useChat` from `ai/react`) — the conversation; render tool calls as
  progress chips ("Fetching node types…", "Validating…", "Dry-running…").
- **Workflow panel** — when the agent creates/updates a draft, show: the workflow JSON
  (collapsible), validation status, and the dry-run **per-node outputs**. A simple
  layered graph render is a nice-to-have.
- **Action bar** — `Activate` and `Run once` buttons (call the server actions). Both
  require an explicit click; `Run once` shows a confirm dialog because it causes real
  side effects. After a run, poll `getRun`/`getRunEvents` and show the timeline.

---

## 10. Guardrails (must-haves)

- `RUNLET_API_KEY` and `OPENROUTER_API_KEY` are **server-only** — never sent to the client.
- The model can read, validate, dry-run, and create **drafts** only. **Activate** and
  **execute** are human-confirmed UI actions.
- Dry-run is the default "try it" — it has no side effects.
- Cap the loop (`maxSteps`) and show a clear error if the agent can't converge.
- Never fabricate credential/connection ids — if missing, instruct the user to create
  the credential (`POST /credentials`) or connect via `${RUNLET_BASE_URL}/oauth/<provider>/start`.

---

## 11. Acceptance scenarios (use as manual tests)

1. **Monitor:** "Every 5 minutes, GET https://example.com/health and Slack #alerts if it's not 200."
   → schedule trigger, `http.request`, `control.if({{ check.status != 200 }})`, `slack.post`
   (via a Slack connection), optionally `state.setNX` to dedupe. Validates + dry-runs clean;
   creates a draft; asks to activate.
2. **Webhook → Slack:** "When my webhook fires, post its `message` to Slack." → `trigger.webhook`
   → `slack.post text:"{{ trigger.message }}"`.
3. **Telegram via HTTP:** "Send me a Telegram message when X." → `http.request POST`
   `https://api.telegram.org/bot{{ $secret.botToken }}/sendMessage` with a `credentialId`;
   agent tells the user to create a `telegram` credential first if none exists.
4. **Repair:** feed it a request that yields a bad port/expression; confirm it reads the
   validate/dry-run error and fixes it without user help.
5. **Safety:** confirm the agent never activates or executes without a button click.

---

## 12. Stretch goals
- Graph visualization + inline editing of the drafted workflow.
- Run history panel (`GET /runs?workflowId=`) with the event timeline.
- Let the user pick/switch the OpenRouter model in the UI.
- "Explain this workflow" and "modify this workflow" modes (load an existing workflow via `GET /workflows/:id`, edit, re-validate).
- Persist chats + generated workflows per user.

---

## 13. Kickoff prompt (paste to a coding agent)

> Scaffold a Next.js (App Router, TypeScript, Tailwind) app called **runlet-copilot**
> per `docs/AGENT_SCAFFOLD.md`. Use the Vercel AI SDK with `@openrouter/ai-sdk-provider`
> for a streaming tool-calling agent. Implement `lib/runlet.ts`, `lib/tools.ts`,
> `lib/prompt.ts`, `lib/model.ts`, `app/api/chat/route.ts`, the activate/execute server
> actions, and a chat + workflow + run UI. The agent must follow the generate→validate→
> dry-run→repair→create loop and must NOT activate or execute without a user click.
> Read the target engine's live reference from `${RUNLET_BASE_URL}/llms.txt` into the
> system prompt. Provide `.env.local.example`. Verify with acceptance scenario #1.
