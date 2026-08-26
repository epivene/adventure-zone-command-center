# Task 8 Report — Gmail Draft Creation

Date: 2026-08-26  
Branch: `feat/lead-gmail-draft-creation`  
Base merge: `62343f3e067fcd8832b9a10b1aa93107f87e15cc`

## Status

Task 8 implementation is present on the feature branch. Static review is complete. Executable verification is blocked by GitHub Actions runner infrastructure: every branch run ends before any job step starts, so this report does **not** claim a passing test suite or typecheck.

No pull request was opened or merged.

## Commit summary

- `d7b53e2ee222f538cab193e657e917f114879574` — RED contract tests for compose OAuth, MIME safety, Gmail draft client, durable idempotency/service safety, handler, migration, individual UI action, and separate Office draft state.
- `b2fc7a45eaace33c2812851fe30b37675ac22424` — backend implementation: forward migration/schema readiness, Gmail client, connection gating, durable link persistence/service, handler.
- `d229dd702e123b552d624c6fe11fc88c82fb6867` — POST/read routes and individual preview/Office Drafts UI.
- `7bbed495c325b01a1e5191837ed5f502ecbc2a00` — focused CI workflow with failure-log artifact handling.
- `43121bbda13810af727ab819ce9a9875fd6aaacf` — approved-template fixture syntax correction.
- `c7f0adae5d6ba778b46b0bd5d83c1e56451846b3` — test fixture aligned to immutable rendered evidence.
- `f85b0b24912c95c81c8d23c7acb8220782a24855` — explicit compose reauthorization regression coverage.

## Files and behavior

### Durable data and schema readiness

- `lib/db/migrations/20260826_lead_gmail_drafts.sql`
- `lib/db/src/lead-intake-schema.ts`
- `artifacts/api-server/src/db/lead-intake-startup-migration.ts`
- `gmail-draft-migration.pglite.test.ts`

The forward migration creates the missing `lead_gmail_draft_links` relation without rewriting an applied migration. It stores row, organization/profile, nullable contact, Google connection, template/version, recipient, rendered subject/body, Gmail draft/message identifiers, state/error, idempotency key, actor, and timestamps. Unique constraints enforce one record per lead event row and unique idempotency.

### Gmail API and authorization

- `google-api-client.ts`, `google-api-types.ts`
- `google-connection-repository.ts` and its tests
- `google-workspace-oauth-callback.ts`
- `google-gmail-draft.test.ts`
- Settings copy in `SettingsGoogleWorkspacePage.tsx`

OAuth adds only `https://www.googleapis.com/auth/gmail.compose` to the existing readonly scopes. Legacy readonly connections retain read access, show reauthorization required, and cannot create drafts until explicitly reauthorized. MIME rejects CR/LF injection, UTF-8 encodes Unicode subject/body, preserves multiline bodies, and supplies Gmail base64url raw content. The only Gmail mutation is `POST /gmail/v1/users/me/drafts`; the client exposes no send operation and does not retry POST.

### Durable service and routes

- `gmail-draft-service.ts` and tests
- `gmail-draft-handler.ts` and tests
- `lead-email-preview-repository.ts`
- `routes/lead-intake.ts`
- `routes/office-email-drafts.ts`

The service serializes per-row work with the existing transaction/advisory-lock path, reloads current state, rejects stale expected review version, rebuilds preview/readiness/DO NOT SEND/template/snapshot evidence immediately before the Gmail call, and persists immutable rendered evidence first. A created record is idempotently returned. A definite API failure becomes retryable on the same record; an uncertain network/invalid-success outcome becomes manual review and is never automatically retried. The read endpoint is separate from `office_email_drafts`.

### Individual UI and state display

- `lead-email-preview.tsx` and `lead-email-preview.gmail-draft.test.tsx`
- `lead-intake-client.ts`, `LeadIntakePage.tsx`
- `lead-gmail-draft-state-list.tsx` and test
- `OfficeEmailDraftsPage.tsx`

Each reviewed row exposes one `Create Gmail Draft` action and status. There is no bulk draft action. Office Email Drafts shows linked lead Gmail state in a separate section.

## TDD and verification evidence

### RED

The RED contract suite was committed first at `d7b53e2...`. GitHub Actions run `32970933806` concluded failure, but GitHub reports zero job steps and no log, so it cannot serve as a trustworthy executable RED transcript. The tests themselves precede production implementation in history.

### Current focused verification attempt

Latest run: `32972738914` at `f85b0b2...`.

- Job `98190059082`: conclusion `failure`
- Job steps API: `[]`
- Job logs: unavailable
- Run artifacts: `[]`

The same zero-step failure occurred on all seven Task 8 branch pushes. Therefore no test assertion or typecheck failure is available to diagnose, and GREEN remains unverified.

### Static verification

- GitHub compare `62343f3e067fcd8832b9a10b1aa93107f87e15cc...f85b0b24912c95c81c8d23c7acb8220782a24855`: `ahead`, 7 commits, 26 changed files, 0 commits behind.
- Fetched all 26 changed files at the head SHA and scanned for exact `drafts.send`, `messages.send`, and `/send`: no exact matches.
- Scanned changed files for a bulk Gmail-draft action: none; only the row-level action is implemented.
- Reviewed Gmail client endpoint/method: one POST to `/gmail/v1/users/me/drafts`; no send route or method was added.

## Self-review findings

- Fixed the approved-template test fixture so reserved immutable evidence is built from the real rendering path.
- Fixed the legacy Google-connection regression expectation: a fully scoped connection is connected; a readonly connection retains reads but requires explicit compose reauthorization.
- Confirmed `contact_id` is nullable and the implementation does not reuse `office_email_drafts`.
- Confirmed the external Gmail call remains inside the serialized mutation-time transaction/lock window, after all current-state gates and durable reservation.
- Confirmed uncertain outcomes are not retried automatically.

## Known blockers and concerns

1. GitHub Actions runner/account infrastructure terminates the job before checkout, producing no steps, logs, or artifacts. Focused tests and typechecks must be rerun in a functioning runner before merge.
2. Because execution is blocked, TypeScript and runtime integration defects remain possible despite static review.
3. The repository already had unrelated Microsoft Office message-send routes on the base branch; Task 8 changes add no Gmail send path or send-capable method.
