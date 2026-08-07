# Deploying Adventure Zone to Render

This project deploys as two Render services sharing a single PostgreSQL database:

| Service              | Type                  | Purpose                   |
| -------------------- | --------------------- | ------------------------- |
| `adventure-zone-api` | Web service (Node.js) | Express API + Clerk proxy |
| `adventure-zone-web` | Static site           | Vite-built React frontend |

---

## Prerequisites

- A [Render](https://render.com) account
- An existing Render PostgreSQL database (the one already in use for dev)
- Your Clerk **production** app's publishable key and secret key
  - If you only have a development Clerk instance, create a production instance at the Clerk dashboard first
- Your Clerk user ID (`user_2abc...`) — find it in the Clerk dashboard under Users

---

## Step 1 — Deploy services from render.yaml

1. Push this repository to GitHub (or GitLab).
2. In the Render dashboard, click **New → Blueprint** and point it at your repository.
3. Render reads `render.yaml` and creates both services. It will pause and ask you to fill in the `sync: false` env vars (see Step 2 before you continue).

---

## Step 2 — Set environment variables

### API service (`adventure-zone-api`)

| Variable                      | Value                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `RENDER_DATABASE_URL`         | Your Render PostgreSQL **External Database URL** (found in the database's Info tab) |
| `CLERK_SECRET_KEY`            | Clerk production secret key (`sk_live_...`)                                         |
| `CLERK_PUBLISHABLE_KEY`       | Clerk production publishable key (`pk_live_...`)                                    |
| `OWNER_CLERK_USER_ID`         | Your Clerk user ID (`user_2abc...`)                                                 |
| `ACT_API_BASE_URL`            | `https://apius.act.com/act.web.api` (server-only)                                   |
| `ACT_DATABASE_NAME`           | Act! database name (server-only secret)                                             |
| `ACT_USERNAME`                | Act! read-only username (server-only secret)                                        |
| `ACT_PASSWORD`                | Act! password (server-only secret)                                                  |
| `ACT_MIGRATION_APPLY_ENABLED` | `false`; Phase 1 is preview/read-only                                               |

### Frontend static site (`adventure-zone-web`) — build-time vars

| Variable                     | Value                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk production publishable key (`pk_live_...`)                      |
| `VITE_CLERK_PROXY_URL`       | `https://<adventure-zone-api URL>/api/__clerk` (fill in after Step 3) |

> **Note:** `VITE_CLERK_PROXY_URL` can only be set after the API service is live.  
> Leave it blank for now and come back in Step 3.

---

## Step 3 — Wire Clerk proxy URL

Once the API service is deployed and has a live URL (e.g. `https://adventure-zone-api.onrender.com`):

1. Go to the `adventure-zone-web` service → **Environment**.
2. Set `VITE_CLERK_PROXY_URL` to:
   ```
   https://adventure-zone-api.onrender.com/api/__clerk
   ```
3. Click **Save Changes** — Render will trigger a new build of the static site.

This routes all Clerk authentication requests through your API, enabling cookie-based auth on the Render domain without CNAME configuration.

---

## Step 4 — Smoke test

After both services show **Live** in the Render dashboard:

1. **API health check** — visit `https://adventure-zone-api.onrender.com/api/healthz`  
   → Should return `{"status":"ok"}` (or similar)
2. **Sign-in flow** — open the frontend URL, click **Sign in**, and complete authentication  
   → Should land on the Today page
3. **Data round-trip** — open Bookings or Contacts and verify data loads from the database

## Phase 1 Act! replacement preview

The durable extraction is a one-way, preview-only archive. It does not apply CRM
changes. After starting or resuming an import, verify only metadata and request
audit records:

```bash
ACT_PREVIEW_BASE_URL=https://adventure-zone-api.onrender.com/api \
ACT_PREVIEW_OWNER_TOKEN='owner bearer token' \
ACT_VERIFY_MODE=pre_apply \
pnpm verify:act-preview
```

The verifier reads the owner-authorized status and request-audit GET endpoints,
checks all seven required roots, identity/completeness/version counters, and a
nonzero Contact count. It prints no source records, headers, bodies, or Act!
credentials. Do not run it against production until the API and database have
been restarted once and the run is visibly resumed from durable checkpoints.

`TEST_DATABASE_URL` is required for the disposable PostgreSQL restart/integration
gate. Without it, run the focused tests and report the integration gate as
skipped; never treat a local no-database run as production evidence.

## One-time Act! import enable window

The checked-in and normal deployed state is locked:

```text
ACT_MIGRATION_APPLY_ENABLED=false
```

Use this exact rollout order. Do not leave the enable window open between
operator sessions.

1. Deploy migrations and the API with `ACT_MIGRATION_APPLY_ENABLED=false`.
   Confirm the Render setting still reads `false` after the deployment.
2. Start or resume extraction and wait for every required stream to reconcile.
3. Organize the archived run. Record only the run ID, terminal phase, manifest
   digest, and aggregate safe/review counts.
4. Run `pnpm verify:act-preview` in `pre_apply` mode. Stop if any required or
   advertised optional stream is unreconciled, organization is nonterminal, any
   active or expired lease remains, durable review/apply adapter evidence is
   absent, or a required relationship is neither dependency-closed and safe to
   apply nor explicitly held for review. Pending dependency-closed operations
   are expected at this readiness gate.
5. Temporarily set `ACT_MIGRATION_APPLY_ENABLED=true` for the API service. This
   is the beginning of the one-time enable window.
6. Import the approved safe-default closure in batches of exactly 25 (the final
   batch may be smaller). Stop on the first blocked or failed batch; do not skip
   ahead or raise the batch size.
7. Set `ACT_MIGRATION_APPLY_ENABLED=false` immediately, before verification,
   handoff, or report generation, and confirm the saved Render value.
8. Restart the API service with apply still disabled. The restart is mandatory;
   it proves the disabled setting and durable replay state survive a new process.
9. Run the post-apply verifier and require final stream/operation reconciliation,
   zero partial/failed identities in every advertised stream, zero active or
   expired leases, terminal required operations, and terminal batch states:

```bash
ACT_PREVIEW_BASE_URL=https://adventure-zone-api.onrender.com/api \
ACT_PREVIEW_RUN_ID='<run id>' \
ACT_PREVIEW_OWNER_TOKEN='<owner bearer token>' \
ACT_VERIFY_MODE=post_apply \
pnpm verify:act-preview
```

10. Generate the metadata-only report. Keep
   `ACT_MIGRATION_APPLY_ENABLED=false` throughout report generation:

```bash
ACT_PREVIEW_BASE_URL=https://adventure-zone-api.onrender.com/api \
ACT_PREVIEW_RUN_ID='<run id>' \
ACT_PREVIEW_OWNER_TOKEN='<owner bearer token>' \
pnpm report:act-import > act-replacement-import.csv
```

The CSV contains only:

```text
run_id,phase,manifest_digest,safe_operations,review_required,applied,already_present,blocked,failed,remaining,apply_batch_count,last_batch_state
```

The command fails closed when required gate evidence or counts are missing, a
lease or batch is active, an operation is unresolved, or blocked/failed work
remains. Never paste source records, review display fields, request bodies,
credentials, cookies, authorization values, or raw archive JSON into the report
or a ticket.

Setting `ACT_MIGRATION_APPLY_ENABLED=false` stops new apply claims; it does not
delete archived or imported rows. Any data reversal requires a separate audited
plan.

---

## Environment variable reference (summary)

```
# API service
NODE_ENV=production              (set automatically by render.yaml)
RENDER_DATABASE_URL=postgres://...
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
OWNER_CLERK_USER_ID=user_...

# Frontend static site (build-time)
NODE_ENV=production              (set automatically by render.yaml)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_CLERK_PROXY_URL=https://<api-url>/api/__clerk
```

---

## Custom domain (optional)

Set up a custom domain in each service's **Settings → Custom Domains** in the Render dashboard.  
After adding the domain to the frontend, update `VITE_CLERK_PROXY_URL` if the API also moves to a custom domain, then redeploy the frontend.
