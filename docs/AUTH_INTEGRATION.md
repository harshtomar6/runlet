# Adding User Auth on Top of Runlet

> How a frontend (or any app) with its own users should integrate with Runlet's
> auth. Runlet's auth is **machine-to-machine tenant auth**, not end-user
> identity — this doc shows how to bridge the two, with a concrete per-tenant
> API-key flow.

---

## TL;DR

- A **Runlet API key = one "owner" = your isolation boundary.** Runlet knows
  nothing about your users; it owner-scopes everything (workflows, credentials,
  connections, runs) by the key you present.
- Your app owns **user identity + per-user authorization.** Runlet owns
  **per-owner tenant isolation.** Bridge them in a **server-side backend
  (BFF)** — the Runlet key never touches the browser.
- Provision **one Runlet API key per isolation boundary** (usually per org),
  store it encrypted mapped to your tenant, and choose the owner **from the
  authenticated session** on every request.

---

## The mental model: two rings

```
[ your user auth ]                 [ Runlet tenant auth ]
 Browser ──your session/JWT──▶ Your backend (BFF) ──Authorization: Bearer <owner key>──▶ Runlet
                               • verify your user                (server-side ONLY)
                               • resolve their tenant → owner key
```

- **Outer ring — your identity layer.** Clerk / Auth0 / NextAuth / Supabase Auth
  / your own — whatever you like. Runlet is not involved.
- **Inner ring — Runlet tenant auth.** Your BFF calls Runlet as the right
  **owner**, using that owner's API key. One key per tenant = Runlet enforces the
  wall between tenants for you.

---

## The three non-negotiables

1. **Never put a Runlet API key in the browser.** No `NEXT_PUBLIC_*`, no client
   `fetch` to Runlet. The key is a secret; it lives only in your backend. The
   browser talks to *your* API; *your* API talks to Runlet.
2. **Choose the owner from the authenticated session, never from client input.**
   Resolve `session.user → tenant → owner key` on the server. If the client could
   pass an `ownerId`/`tenantId`, a user could claim another tenant (IDOR).
3. **Don't use Runlet auth as your user auth.** It has no login, passwords,
   sessions, or per-user roles — it's a tenant credential. Layer your own on top.

---

## Choosing owner granularity

| Your app | Runlet owner = | Isolation enforced by |
|---|---|---|
| **B2B SaaS (orgs/teams)** — *recommended default* | one owner **per org** | Runlet + your layer |
| B2C, independent users | one owner **per end-user** | Runlet + your layer |
| Single-tenant / internal tool | **one shared** owner | your layer only |

Prefer **per-tenant (per-org) owners** for anything multi-user: tenant A's
workflows, credentials, Slack/Google connections, and run history become
**invisible to tenant B — enforced by Runlet**, not just by your query filters.
Defense in depth. Use a single shared owner only for single-tenant/internal use.

---

## Per-tenant API-key flow

### What Runlet gives you
- **API key → owner.** Send `Authorization: Bearer <key>`; Runlet resolves the
  owner and scopes everything to it.
- `POST /api-keys` — mint an **additional** key for **your own** owner (i.e. the
  owner of the calling key). For **rotation / multiple keys per tenant**, not for
  creating new tenants. Returns the raw `key` **once**.
- `GET /api-keys` — list your owner's key metadata (no secrets).
- `DELETE /api-keys/:id` — revoke a key.
- `pnpm create-api-key --owner <ownerId> --name <label>` — server-side script
  that mints a key for **any** owner (this is how a brand-new tenant gets its
  first key).

> Note the asymmetry: `POST /api-keys` can only mint for the *caller's* owner.
> Creating a key for a **new** owner is a privileged operation — the
> `create-api-key` CLI, or `POST /admin/tenants` (guarded by `ADMIN_SECRET`; below).

### 1. Onboard a tenant → provision its owner key (server-side)

When a new org signs up in your app:

1. Create a stable `tenantId` in your DB (e.g. your org id). This **is** the
   Runlet `ownerId` — keep it stable and opaque.
2. Mint a Runlet key for that owner and store it **encrypted**, mapped to the
   tenant. Two setups:

**Setup A — your BFF can run Runlet provisioning (co-located / has the script):**
```bash
pnpm create-api-key --owner "$TENANT_ID" --name "bff"
# → capture the printed key ONCE, encrypt, store as tenants.runletKey
```

**Setup B — your BFF is a separate service (the common case):** use the built-in
**admin provisioning endpoint**, guarded by a shared `ADMIN_SECRET` (set it in
Runlet's env; fail-closed — `503` if unset, `401` on a bad secret):
```
POST /admin/tenants           headers: x-admin-secret: <ADMIN_SECRET>
  body: { ownerId, name? }               # ownerId = your stable tenant id
  → 201 { ownerId, id, prefix, key }     # `key` is returned ONCE — encrypt + store it
```
Your BFF calls this once per tenant at onboarding, then never again. This is the
one operation `/api-keys` can't do (it only mints for the *caller's* owner).

Either way you end up with a server-side map:
```
tenants: { id (=ownerId), ...your fields, runletKey (encrypted) }
```

### 2. Per-request: pick the owner from the session

Your BFF resolves the caller's tenant from the verified session and uses that
tenant's key. Sketch (framework-agnostic):

```ts
// server-side only
async function runletFetch(session, path, init) {
  const tenant = await db.tenantForUser(session.userId);   // authz happens here
  if (!tenant) throw new ForbiddenError();
  const key = decrypt(tenant.runletKey);                   // never sent to the client
  return fetch(`${RUNLET_BASE_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${key}`, "content-type": "application/json" },
  });
}
```
The browser calls *your* routes (e.g. `POST /api/workflows`); those routes call
`runletFetch(...)`. The Runlet key is chosen from the session — the client never
names the owner.

### 3. Rotation & revocation (self-service, per tenant)
Within a tenant you can rotate keys without re-provisioning the owner:
`POST /api-keys` (as that tenant's key) to mint a new one, switch your stored
key, then `DELETE /api-keys/:id` the old one. Revoke a leaked key the same way.

---

## Per-user authorization *within* a tenant is your job

A per-tenant owner gives you the **tenant wall**, but Runlet only knows the
tenant — not which of your users may see/edit which workflow. Finer-grained
rules (roles, "user X owns workflow Y", read-only members) live in **your**
layer: map your user → allowed `workflowId`s / actions before calling Runlet.
Runlet is the outer isolation boundary; you build authorization above it.

---

## Endpoints that intentionally bypass end-user auth

These aren't called by your logged-in users, so your session doesn't apply:

- **`POST /hooks/:workflowId`** (inbound webhooks) — called by external systems;
  authenticated by the webhook **signature** (`WEBHOOK_SECRET`), and the run
  executes as the workflow's stored owner.
- **`GET /oauth/:provider/callback`** — a browser redirect validated by the
  single-use `state`, not your session.
- **`GET /node-types`, `GET /llms.txt`, `GET /health`** — public reads. (When you
  *do* send a key, `/node-types` also merges that owner's custom nodes.)

---

## Anti-patterns

- ❌ Handing a Runlet API key to the browser as if it were a user token.
- ❌ Trusting an `ownerId`/`tenantId` from the request body instead of the session.
- ❌ One key per **user** when users share **orgs** (you'll fight to share
  workflows within a team — use one owner per org instead).
- ❌ Treating Runlet's API key as your identity system (no users/roles there).

---

## Checklist

- [ ] Runlet key(s) stored **encrypted, server-side only**.
- [ ] One owner per isolation boundary (org, usually).
- [ ] Owner resolved from the **authenticated session** every request.
- [ ] A provisioning path for new tenants (CLI, or the admin endpoint).
- [ ] Your own per-user authorization above the tenant wall.
- [ ] Rotation/revocation via `/api-keys`.
- [ ] Webhook/OAuth callback routes reachable without your session (they use
      their own auth).
