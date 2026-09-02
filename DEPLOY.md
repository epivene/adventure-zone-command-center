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

| Variable                      | Value                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `RENDER_DATABASE_URL`         | Your Render PostgreSQL **External Database URL** (found in the database's Info tab)  |
| `CLERK_SECRET_KEY`            | Clerk production secret key (`sk_live_...`)                                          |
| `CLERK_PUBLISHABLE_KEY`       | Clerk production publishable key (`pk_live_...`)                                     |
| `OWNER_CLERK_USER_ID`         | Your Clerk user ID (`user_2abc...`)                                                  |
| `ACT_API_BASE_URL`            | `https://apius.act.com/act.web.api` (server-only)                                    |
| `ACT_DATABASE_NAME`           | Act! database name (server-only secret)                                              |
| `ACT_USERNAME`                | Act! read-only username (server-only secret)                                         |
| `ACT_PASSWORD`                | Act! password (server-only secret)                                                   |
| `ACT_MIGRATION_APPLY_ENABLED` | `false`; Phase 1 is preview/read-only                                                |
| `ASSISTED_CALLING_ENABLED`    | `false`; enable only after migration and owner smoke gates pass                      |
| `VOICEMAIL_LAUNCH_URL`        | Optional private launcher URL; leave unset when no launcher is configured            |
| `TWILIO_VOICE_ENABLED`        | `false`; do not enable until the controlled browser-call test succeeds               |
| `TWILIO_ACCOUNT_SID`          | Twilio Account SID; server-only Render secret                                        |
| `TWILIO_API_KEY_SID`          | Twilio API Key SID for browser Voice tokens; server-only Render secret               |
| `TWILIO_API_KEY_SECRET`       | Matching Twilio API Key secret; server-only Render secret                            |
| `TWILIO_AUTH_TOKEN`           | Twilio Account Auth Token for webhook signature validation; distinct from API secret |
| `TWILIO_TWIML_APP_SID`        | TwiML App SID used when issuing browser Voice tokens; server-only Render secret      |
| `TWILIO_VERIFIED_CALLER_ID`   | Existing verified Adventure Zone work number in E.164 form; server-only Render value |
| `TWILIO_WEBHOOK_BASE_URL`     | Public API HTTPS origin, e.g. `https://adventure-zone-api.onrender.com`              |

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

## Assisted-calling rollout

Keep `ASSISTED_CALLING_ENABLED=false` during the initial code deployment and
database migration. Follow [the assisted-calling runbook](docs/assisted-calling-runbook.md)
for backfill verification, owner smoke testing, enablement, and rollback.
`VOICEMAIL_LAUNCH_URL` is optional and server-only. Configure its private value
in Render rather than committing it; the user-facing action remains **Leave
voicemail**, and launching it does not record an outcome.

---

## Twilio computer-calling rollout

This is an outbound-only, owner-controlled rollout. It does not receive calls
in the browser, change the existing work phone or carrier, route callbacks to a
browser, record calls, create voicemail, transcribe audio, or support emergency
calling. Keep both `ASSISTED_CALLING_ENABLED=false` and
`TWILIO_VOICE_ENABLED=false` until the controlled test step below.

### 1. Obtain and keep Twilio credentials server-only

In the Twilio Console, obtain the Account SID, then create a restricted API key
for browser Voice tokens and retain its SID and secret. Also obtain the Account
Auth Token used solely to validate signed Twilio webhooks. The API-key secret
and Account Auth Token are separate values; never substitute one for the other.
Enter all values only in the Render API service Environment panel. They must not
be committed, pasted into tickets, exposed through Vite, or returned by the
configuration endpoint.

### 2. Verify the existing work caller ID

Verify the existing Adventure Zone work number with Twilio as an outbound caller
ID and enter it in `TWILIO_VERIFIED_CALLER_ID` in E.164 format. Do not port the
number or alter its carrier forwarding. Incoming calls and callbacks must remain
on the physical work phone. This release has no inbound-browser route.

### 3. Create the TwiML App and set the public webhook URLs

Create a TwiML App in the same Twilio account and set its Voice Request URL
(POST) to the exact public API URL:

```text
https://<api-host>/api/webhooks/twilio/voice/outbound
```

Set `TWILIO_TWIML_APP_SID` to that app's SID. Set
`TWILIO_WEBHOOK_BASE_URL` to the HTTPS origin only, with no trailing path, for
example `https://adventure-zone-api.onrender.com`. The application-generated
TwiML sends status callbacks to this exact public URL:

```text
https://<api-host>/api/webhooks/twilio/voice/status
```

Do not add an incoming-number Voice URL, recording URL, or any browser inbound
route. The application validates the Twilio signature for both public webhook
routes using `TWILIO_AUTH_TOKEN` and rejects unsigned requests.

### 4. Deploy disabled and run no-call smoke checks

1. In Render, set the eight variables listed above, but leave
   `TWILIO_VOICE_ENABLED=false` and `ASSISTED_CALLING_ENABLED=false`.
2. Deploy the API and run the normal database migration command. Do not create a
   Twilio account, verify a number, set production secrets, deploy, or place a
   call merely to follow this document; those are operator actions in an
   approved release window.
3. Confirm `GET https://<api-host>/api/calls/config` reports
   `computerCalling.enabled: false`. It must remain false until the operator
   deliberately enables both gates and all credentials are complete.
4. Confirm the existing Phone Link / `tel:` fallback remains available. Confirm
   that opening a Call Workspace does not initiate a browser call.

### 5. Controlled own-phone test

Only in an approved release window, set both
`ASSISTED_CALLING_ENABLED=true` and `TWILIO_VOICE_ENABLED=true` for the API
service. Use an eligible stored test contact and a phone you own or another
explicitly consenting internal/test recipient. A Twilio trial account may call
only Twilio-verified recipient numbers. Never use this feature for emergency
calling.

1. Open the Call Workspace, set up the microphone, and check the displayed
   destination and the Adventure Zone work caller ID.
2. Select **Call now** explicitly; do not use a profile page, auto-dial action,
   or a browser-supplied destination.
3. Confirm the recipient sees the verified work number. Exercise mute, keypad,
   microphone/speaker selection where supported, hangup, and the normal outcome
   and notes workflow. Verify the technical result links to the saved business
   outcome without persisting browser tokens or device labels.
4. Call the work number back and confirm the physical work phone rings. A
   callback must never arrive in the browser.
5. Verify Twilio call recording is disabled: do not enable Console recording,
   do not configure a recording webhook, and confirm no recording or
   transcription was created for the controlled call. Do not test or send a
   voicemail; voicemail delivery is outside this feature.

### 6. Disable and roll back

Set `TWILIO_VOICE_ENABLED=false` and save/redeploy the API. Confirm
`GET /api/calls/config` again reports `computerCalling.enabled: false`; retain
`ASSISTED_CALLING_ENABLED=false` unless a separately approved assisted-calling
rollout remains active. Leave additive database migrations and existing call
records in place. Verify Phone Link remains available, capture only safe release
metadata and request IDs, and do not copy credentials, full phone numbers,
tokens, webhook bodies, recordings, or call notes into an incident report.

---

## Environment variable reference (summary)

```
# API service
NODE_ENV=production              (set automatically by render.yaml)
RENDER_DATABASE_URL=postgres://...
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
OWNER_CLERK_USER_ID=user_...
ASSISTED_CALLING_ENABLED=false
VOICEMAIL_LAUNCH_URL=<optional private URL configured in Render>

# Frontend static site (build-time)
NODE_ENV=production              (set automatically by render.yaml)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_CLERK_PROXY_URL=https://<api-url>/api/__clerk
```

---

## Custom domain (optional)

Set up a custom domain in each service's **Settings → Custom Domains** in the Render dashboard.  
After adding the domain to the frontend, update `VITE_CLERK_PROXY_URL` if the API also moves to a custom domain, then redeploy the frontend.
