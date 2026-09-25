# Assistant activation readiness verification

Reviewed implementation: local commit `1ecee94` plus the bounded CI timeout adjustment.

## What changed

- Owner-only setup status remains available while disabled and reports safe setting names, owner access, actual schema/rule readiness, startup state and optional saved connection status.
- Workspace routes remain closed until schema/rule initialization and worker startup succeed. Optional document credentials are constructed only when a document operation needs them.
- The workspace shows required setup, optional connections, server instructions, Google settings and refresh/retry controls. Unavailable setup does not load saved conversations.
- The Render blueprint includes server-only assistant settings and keeps the feature disabled by default.
- Removed a malformed one-off code-writing workflow; restored read-only booking CI, added assistant regression/build CI and aligned startup CI to Node 22.

## Validation

- Backend regression: 49 files / 221 tests pass on Node 22.23.2 using the exact CI selection and bounded 30-second test/hook limits (238.06 seconds).
- Workspace UI: 6 files / 16 tests pass, including blocked conversation reads and setup refresh recovery.
- Booking/startup backend: 11 files / 66 tests pass. Booking UI: 13 tests pass.
- API and frontend production builds pass on Node 22.23.2. Database workspace build passes.
- API/UI typechecking retains the existing 94 / 135 errors, respectively. Compared normalized diagnostics to the prior baseline: no new unique errors and no workspace errors.
- All 84 workflow YAML files and Render YAML parse.
- Initial full backend run: 220 / 221 passed; an unchanged year-end inspection copy test exceeded its default five-second deadline during concurrent builds. Its entire 15-test file passes with the bounded 30-second test deadline now used by assistant CI. No assertion was removed.

## Independent review

A fresh gpt-6-astra reviewer inspected the full branch and dependencies. No Critical or Important findings. One deferred minor: rollout text should clarify that an unusual existing table missing a required column can require an explicit corrective migration; the pre-existing installer cannot repair every detected discrepancy. Readiness correctly blocks such a schema. The reviewer reproduced this with a missing extraction `call_id` in PGlite.

## Read-only production observations

PR #949 successfully deployed to the API. The live workspace displays the generic disabled setup screen. Render contains an OpenAI key and Google/storage configuration key names; no assistant workspace activation/model/actor settings were present. Values were kept masked. The live Google settings page shows the company Gmail connection and separate operational calendar as connected. These observations do not establish live token validity or successful provider operations. No settings were changed and no email, sync, reconnect or deployment was triggered.

## Limits and execution decisions

Native PostgreSQL migration acceptance, actual OpenAI access/billing, live Gmail/calendar operations, private-file access and browser rendering of this unreleased UI remain unverified. Production configuration must be completed after review/merge before a controlled pilot. The local component tests and PGlite tests do not replace those checks. Hosted Actions results must be inspected separately.

The installed task helper scripts were not executable, including nested helpers. Progress, task boundaries and test evidence were therefore tracked manually in the plan ledger; the committed plan and this report provide the durable record. This affects bookkeeping, not product behavior.

Unrelated concurrent main changes are preserved by publishing only the reviewed changed files atop the latest remote tree and verifying every untouched blob.
