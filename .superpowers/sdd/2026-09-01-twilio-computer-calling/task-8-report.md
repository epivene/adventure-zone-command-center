# Task 8 report: disabled Twilio rollout and verification

## Implementation

- Added all eight Twilio variables to `render.yaml`. `TWILIO_VOICE_ENABLED` is
  the checked-in string value `"false"`; the other seven values are Render-only
  `sync: false` placeholders. No credential, phone number, or public deployment
  value was committed.
- Added the deployment runbook to `DEPLOY.md`. It documents the separate Twilio
  API-key secret and Account Auth Token, verified existing work caller ID, TwiML
  App Voice Request URL `https://<api-host>/api/webhooks/twilio/voice/outbound`,
  application-generated status callback
  `https://<api-host>/api/webhooks/twilio/voice/status`, Render configuration,
  disabled smoke checks, a controlled own-phone/consenting-recipient test,
  physical-phone callback verification, recording/privacy checks, and rollback.
- The runbook preserves both gates: computer calling requires the existing
  `ASSISTED_CALLING_ENABLED` gate as well as `TWILIO_VOICE_ENABLED`. It excludes
  inbound browser calling, recordings, transcription, voicemail testing, and
  emergency calling. Trial-account recipient verification is called out.

No new configuration test was planned for Task 8: its specified file scope is
the declarative Render template and deployment documentation. Existing
configuration behavior is covered by the Task 1 computer-calling configuration
and `/calls/config` route tests, both included in the focused run below.

## Verification

All commands were run from the repository root. No Twilio account was created,
no number was verified, no Render secret was set, no deployment was made, and no
real call was placed.

| Command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Result                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-config.test.ts src/features/calls/nanp-phone.test.ts src/features/calls/computer-call-repository.test.ts src/features/calls/computer-calling-service.test.ts src/features/calls/twilio-computer-voice-provider.test.ts src/features/calls/computer-calling-rate-limit.test.ts src/routes/computer-calling.test.ts src/routes/twilio-voice-webhooks.test.ts src/routes/calls.test.ts src/db/computer-calling-required-startup.test.ts src/db/required-schema-startup.test.ts src/features/calls/call-service.test.ts` | Passed: 12 files, 118 tests.                                                                                                                                                 |
| `pnpm --filter @workspace/adventure-zone exec vitest run src/hooks/use-computer-call.test.tsx src/components/calls/phone-actions.test.tsx src/components/calls/computer-call-panel.test.tsx src/components/calls/call-workspace.test.tsx src/components/calls/call-workspace.computer-call.integration.test.tsx src/pages/CallWorkspacePage.test.tsx`                                                                                                                                                                                                                                                         | Passed: 6 files, 98 tests (fresh Task 8 fix-round verification).                                                                                                             |
| `pnpm --filter @workspace/db run build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Passed (`tsc -p tsconfig.json`).                                                                                                                                             |
| `pnpm install --frozen-lockfile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Passed; lockfile up to date and policy check passed.                                                                                                                         |
| `pnpm --filter @workspace/api-server run build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Passed.                                                                                                                                                                      |
| `pnpm --filter @workspace/adventure-zone run build`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Passed.                                                                                                                                                                      |
| `pnpm exec prettier --check render.yaml DEPLOY.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Passed.                                                                                                                                                                      |
| Render declaration structural check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Passed: disabled flag plus seven secret placeholders.                                                                                                                        |
| `git diff --check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Passed.                                                                                                                                                                      |
| Targeted secret/privacy grep (exact command below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Reviewed. No Twilio secret assignment was found; `destination` matches are existing non-call fields, provider internals, or the explicit browser-destination rejection test. |

```bash
git grep -nE 'TWILIO_(API_KEY_SECRET|AUTH_TOKEN)=|recording|recordings|destination:' -- ':!docs/superpowers' ':!DEPLOY.md'
```

## Repository-wide typecheck baseline

`pnpm typecheck` was rerun in Task 8 fix round 1 and exits 1 at the recorded
repository baseline. The
libraries, scripts, and AVZ CRM checks complete, then the API package reports
pre-existing unrelated diagnostics. Representative unchanged areas are scout
alerts, ACT recovery, activities, communication templates, event families,
trips, and Google Workspace routes/tests. The existing call-area baseline also
includes `src/features/calls/call-repository.ts`, `src/features/calls/call-service.ts`,
and the `src/routes/calls.ts(155,82)` completion-handler enum/input mismatch;
`git blame` shows the underlying `routes/calls.ts` line predates the Twilio work
at `ab2860aac` (2026-08-01). The fresh compiler output contains no diagnostic in
Twilio or computer-calling modules. Per the ledger ruling, this is reported as a
non-green repository-wide check rather than being claimed as a pass or altered
outside task scope.

## Deployment limitation and rollout state

There is no deployed endpoint to query in this task, because deployment and
secret configuration were deliberately not authorized. The checked-in Render
template leaves `TWILIO_VOICE_ENABLED=false`, and the documented next smoke
check is `GET https://<api-host>/api/calls/config`, which must report
`computerCalling.enabled: false` until an operator intentionally enables both
feature gates in an approved release window.

## Commit

Included in the Task 8 documentation commit; the final immutable commit ID is
reported in the completion handoff.
