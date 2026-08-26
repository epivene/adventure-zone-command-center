# Task 8 Report — Gmail Draft Creation

Date: 2026-08-26  
Branch: `feat/lead-gmail-draft-creation`  
Base merge: `62343f3e067fcd8832b9a10b1aa93107f87e15cc`  
Implementation head before this report: `4aa50639a1235431e015a4b04134a5c583d6c1df`

## Status

Task 8 and the independent-review corrections are implemented on the feature branch. Static verification is complete. Executable GREEN remains unverified because every GitHub Actions job terminates before its first step; this report does not claim passing tests or typechecks.

No pull request was opened or merged.

## Commit lineage

Initial Task 8:

- `d7b53e2ee222f538cab193e657e917f114879574` — RED safety/API/UI/migration contracts.
- `b2fc7a45eaace33c2812851fe30b37675ac22424` — durable backend, forward schema, Gmail draft-only client.
- `d229dd702e123b552d624c6fe11fc88c82fb6867` — route and individual UI action/state.
- `7bbed495c325b01a1e5191837ed5f502ecbc2a00`, `43121bbda13810af727ab819ce9a9875fd6aaacf`, `c7f0adae5d6ba778b46b0bd5d83c1e56451846b3`, `f85b0b24912c95c81c8d23c7acb8220782a24855` — focused workflow and test-fixture corrections.
- `186c13c6a1a1ae9588cbb9febdec15bc80d3ae0f` — original Task 8 report.

Review correction pass:

- `e8c081a2f70852f764c1f97f146992d8172980c5` — repaired invalid literal escaped newlines in the Google connection test.
- `69351b55312460041d695b0e56e11a4bcc71e574` — RED contracts for persisted state reload, CRM history/audit, strict readiness, lock-time clock, complete OAuth suites, and Gmail timeout.
- `2c5e36b656121b440b88de6326541687b7e8e14e` — bounded draft mutation, lock-acquired clock, CRM activity/audit, activity link, and state-read API.
- `2cb332d7ddb4475570d1c1291f70ba0a8c1c848c` — reload and display durable per-row Gmail draft state.
- `cd1af26008090178ed3bb2efc8d03e210abac17d` — fail-closed canonical draft-link readiness.
- `0146d88c0c8a48c51a717b6d99834bcdc4840f70` — complete startup and legacy Google fixtures.
- `991e0f620d5e4287c952c1f9c46f660f7552b340` — corrected the migration dollar-quote opener.
- `2999971816fa39986806b5273b9e77fa511b06e2`, `53e47ad1adeb7016359f3b351b88e84212fe9201` — RED and fix for the preview/durable-state lookup race; timeout now covers response parsing.
- `dd2d4e50a6ecb416bd37dbeb1bbce685f6412405` — RED weakened-check readiness cases.
- `72e8f03a5d7d39c9dd02baab0336c78b078c151e`, `4aa50639a1235431e015a4b04134a5c583d6c1df` — RED/GREEN for real startup ordering and one complete token-to-response timeout budget.

GitHub compare reports implementation head `4aa5063` is 20 commits ahead of, zero behind, and directly descended from the base. It is also ahead of the escaped-newline fix `e8c081a`, startup fixture fix `0146d88`, and dollar-quote fix `991e0f6`.

## Review corrections

### Durable state after reload

The API now exposes authenticated per-row GET and POST routes at `/lead-intake/rows/:rowId/gmail-draft`. The preview panel loads the existing durable link on row/review reload and shows:

- Gmail draft created
- Gmail draft requires manual review
- Gmail draft creation can be retried

A created, prepared, or manual-review record never exposes another create action. A retryable definite failure may retry the same durable record. Separate request generations prevent preview loading from discarding an in-flight draft-state lookup. Mutation errors reload the durable state so an uncertain/prepared record is visible without another create attempt.

### CRM/profile history and audit

`lead_gmail_draft_links.activity_id` links each successful draft record to one CRM `activities` row. After Gmail returns identifiers, the same serialized database transaction:

1. inserts an organization-linked CRM note;
2. preserves nullable `contact_id` for organization-inbox recipients;
3. updates the durable link to `created` with Gmail and activity identifiers;
4. writes audit entries for the activity and lead Gmail draft transition.

If history/audit persistence fails after an external Gmail success, the transaction rolls back to the earlier durable `prepared` reservation, so a later request requires manual review instead of issuing another Gmail mutation.

### Canonical schema readiness

The forward migration and Drizzle schema now include the activity link/FK/index. Isolated readiness verifies:

- all 22 required columns;
- data types, required/nullable columns, ID/state/attempt/timestamp defaults;
- primary key;
- exact row and idempotency unique constraints;
- row, organization, nullable contact, Google connection, communication template, and activity FKs with correct target and delete behavior;
- state, email, nonblank text, positive attempt, and created-completeness checks;
- partial unique Gmail draft/message/activity indexes;
- state/updated and organization/updated lookup indexes.

PGlite contracts mutate a canonical table's FK target, contact nullability, state default, index uniqueness, email check, and state set. Each weakened same-name structure must report not ready.

The SQL file contains exactly one balanced `DO $$ BEGIN` / `END $$;` pair.

### Complete mutation-time clock and timeout

Both durable preparation and Gmail execution receive the clock callback and invoke it only after the advisory lock/row lock and current-state reload. The second clock read feeds the immediate readiness/evidence recomputation and Gmail mutation.

One AbortController budget starts before refresh-token acquisition and remains active through the Gmail draft POST and response-body parsing. Token or Gmail timeout/abort maps to `GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN`, which becomes durable `manual_review` and is not automatically retried. Definite API failures remain retryable on the same idempotency record.

### Startup ordering

Server bootstrap now coordinates required schemas in dependency order:

1. paper notes;
2. Google Workspace;
3. lead intake;
4. Office coordinator.

The lead Gmail FK therefore cannot run before `google_workspace_connections` exists. The empty-database startup test invokes the real Google schema migration rather than precreating the Google connection table, then runs lead-intake startup.

### Legacy Google coverage

Successful OAuth callback, safe-return redirect, account-change conflict, API client, and connection repository fixtures use `GOOGLE_WORKSPACE_REQUIRED_SCOPES` where full authorization is intended. The unexpected `gmail.modify` test includes all required scopes before the extra scope. A dedicated readonly fixture still proves read access remains available while compose requires explicit reauthorization.

The focused workflow now includes all of these legacy suites, Task 8 service/handler/history/migration/startup suites, UI suites, API/frontend typechecks, and DB build.

## Static verification at `4aa5063`

GitHub compare: `ahead`, 20 commits ahead, 0 behind, 35 changed files.

A connector-based scan fetched all 34 changed TS/TSX/SQL/YAML files at the exact head SHA and found:

- no exact `drafts.send` or `messages.send` symbol;
- no Gmail send endpoint/route;
- no bulk Gmail/draft action;
- no suspicious literal escaped-newline sequence outside intended string/regex content;
- no broken `DO $ BEGIN`;
- exactly two `$$` delimiter tokens, forming one opener and one closer.

The only Gmail mutation endpoint in changed source remains `POST /gmail/v1/users/me/drafts`. Lead Gmail UI states do not claim that a message was sent.

## Executable verification evidence

Latest run: `32975888156` at `4aa50639a1235431e015a4b04134a5c583d6c1df`.

- Job: `981? replaced below`
- Actual focused job ID: `98200397488`
- Job conclusion: `failure`
- Job steps API: `[]`
- Job logs URL: `null`
- Run artifacts: `[]`

The same zero-step termination has occurred for every Task 8 branch push, including RED and GREEN commits. There is no assertion failure, compiler diagnostic, or log artifact to inspect.

## Known blocker

A functioning runner or authorized local checkout must execute the focused workflow before merge. Until then, TypeScript, PGlite, and runtime integration remain unverified despite the tests and static review.
