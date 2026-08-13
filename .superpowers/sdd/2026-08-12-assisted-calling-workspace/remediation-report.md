# Assisted calling final blocker remediation report

**Date:** 2026-08-13
**Repository:** `epivene/adventure-zone-command-center`
**Branch:** `agent/assisted-calling-workspace`
**Authoritative starting head:** `7c160576103fce86af8a882ae9ba829960775440`
**Verified implementation commit:** `90d53c1ba567ead3243f4a3623287f18da13d6e0`
**Verified implementation tree:** `743be00c28f09814330b259d51655df3364397ce`

## Status

All three assisted-calling blockers were remediated with test-first regressions,
focused GREEN verification, independent task reviews, a whole-branch review,
one reviewed final fix wave, and the exact required full verification chain.

`ASSISTED_CALLING_ENABLED` remains false. No deployment, feature enablement,
production migration, OS phone-handler check, private voicemail-launcher check,
or production database operation was performed.

## Authoritative checkout and baseline

The supplied checkout at `task10-repo` was a normal checkout at `17bf47d...`
with extensive unrelated tracked and untracked state. It was preserved
untouched. A separate runnable remediation checkout was initialized from the
authoritative remote tree. Every active application, library, script, plan,
design, runbook, and root workspace blob used by the build matched remote head
`7c160576...`; there were zero mismatches or missing core files. Unrelated
remote backup/assets remained in the connector-created remote base tree and
were never rewritten.

The clean baseline exact chain exited 0:

```text
API:        62 passed files, 2 skipped; 774 passed tests, 49 skipped
Web:        20 passed files; 144 passed tests
Typecheck:  libraries, API, web, and scripts exited 0
Build:      API and web production builds exited 0
```

## Blockers 1 and 2 — ACT normalization and destination-level DNC

### Root causes

- ACT replacement create/fill/overwrite/update/clear paths changed
  `contacts.phone` without consistently co-writing canonical
  `contacts.normalized_phone`.
- Migration 022 matched legacy compatibility rows by raw display text and
  trusted `NEW.normalized_phone`, allowing null/stale normalization and a
  formatting-only unsuppressed duplicate.
- Ordinary replacement had stable-ID and suppressed-row guards, but no
  per-contact canonical destination collision check.
- The database lacked a per-contact non-null canonical uniqueness boundary.
- Existing migration-022 drift included blank legacy contacts retaining stale
  primaries and canonical matches retaining stale display values.
- The rollout query allowed stored null/null normalization to pass.

### Initial RED

```text
pnpm --filter @workspace/api-server exec vitest run \
  src/features/contact-phones/contact-phone-repository.test.ts \
  src/features/act-replacement/drizzle-apply-repository.test.ts \
  src/db/act-review-migrations.test.ts
```

Result: exit 1; 3 files failed, 9 tests failed, 44 passed. Failures proved the
four missing ACT normalization write classes, three accepted canonical
duplicates, missing migration 023, and missing schema unique index.

Additional focused REDs:

```text
contacts route duplicate: expected 400, received 500
migration partial state: CREATE UNIQUE INDEX lacked IF NOT EXISTS
SQL parity: locale-sensitive [:alnum:] differed from JavaScript ASCII word rules
legacy repair: cleared contact remained primary=true instead of false
```

### Implementation

- ACT contact writers now co-write `normalized_phone` via
  `normalizeNorthAmericanPhone`, including null on clear.
- Ordinary phone replacement canonicalizes before mutation and rejects new,
  edited, reformatted, or suppressed-destination collisions with actionable
  HTTP 400 behavior while leaving distinct destinations valid.
- Additive registered migration
  `023_contact_phone_canonical_dnc.sql` derives supported North American
  canonical values, repairs stored drift, deterministically collapses duplicate
  destinations, merges the earliest DNC timestamp and all distinct reasons,
  remaps `call_sessions.phone_id`, preserves primary/legacy compatibility, and
  adds a partial unique index on `(contact_id, normalized_number)`.
- The replacement trigger matches canonical destination before raw display,
  reuses the existing row, preserves DNC fields, and handles legacy clear.
- The runbook derives expected normalization from raw phone and fails on null,
  mismatch, wrong/missing primary, display drift, or blank contacts retaining
  primary/canonical state.
- PGlite test coverage is mandatory and executes the full migration plus real
  Drizzle ACT create/update/clear, exact caller lookup, trigger behavior,
  uniqueness, DNC/history reconciliation, and migration rerun.

### GREEN

```text
Focused amended suite: 4 files, 63 passed, 0 skipped
Expanded affected suite: 8 files, 105 passed, 0 skipped
pnpm run typecheck:libs: exit 0
pnpm --filter @workspace/api-server typecheck: exit 0
```

Detailed chronology and output are in
`remediation-phones-report.md`.

## Blocker 3 — contact ZIP-only caller search

### Root cause

The real SQL predicate narrowed on `contacts.postal_code`, but the repository
did not project that evidence into `CallerFinderCandidate`. The service could
therefore assign neither the existing `Location` reason nor its 150-point score
and discarded a contact matched only by ZIP.

### RED

```text
pnpm --filter @workspace/api-server test \
  src/routes/caller-finder-zip.integration.test.ts \
  src/features/caller-finder/caller-finder-service.test.ts
```

Result: exit 1. The repository row lacked `matchedContactPostalCode`; service
and HTTP suggestions were empty instead of returning `Location`/150.

### Implementation and GREEN

The repository now projects a null-safe contact-postal match flag from the same
real SQL query. The candidate contract carries it and the service scores it as
the existing `Location` evidence. No synthetic `matchedLocation: true` shortcut
was added.

The PGlite route fixture includes 65 unrelated due-today contacts ahead of the
target, proving the nonempty ZIP query narrows before the unchanged 64-row
repository cap. The unchanged service cap is eight, sorting remains
deterministic, and the ZIP-only response remains `exact: none` and click-only.

```text
Focused final: 3 files, 20 passed
pnpm --filter @workspace/api-server typecheck: exit 0
```

Detailed chronology and output are in `remediation-zip-report.md`.

## Final review fix wave — atomic distinct primary edit

The whole-branch review found one Important integration defect: atomic
`PUT /contacts/:id` updated legacy phone first, so migration 023's AFTER trigger
created destination B before replacement reconciled the submitted destination-A
row ID. A legitimate A-to-distinct-B edit then returned HTTP 400. The review
also requested direct quick-caller duplicate-gate evidence for an ACT-created,
reformatted destination.

### RED

```text
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/contacts.atomic-pglite.test.ts
```

Result: exit 1; 2 failed, 1 passed. The legitimate distinct edit expected 200
but received 400; the suppressed edit surfaced the trigger-created duplicate
instead of the immutability error. The rollback fixture passed.

### Fix and GREEN

The route now replaces phone rows first inside the existing outer transaction,
derives legacy fields from the saved primary, then updates the remaining contact
fields. A later failure rolls the replacement back, and DNC/uniqueness guards
remain unchanged.

```text
Real PGlite HTTP suite: 1 file, 4 passed, 0 skipped
Focused amended suite: 5 files, 67 passed, 0 skipped
Expanded affected suite: 11 files, 118 passed, 0 skipped
API typecheck: exit 0
```

The ACT/PGlite test also calls the real quick-caller exact gate with
`701.555.0199` and confirms the reformatted ACT-created destination is blocked.
Scoped re-review marked both findings addressed with no new Critical or
Important breakage.

## Reviews

- Phone/DNC task review: PASS; no Critical, Important, or Minor findings.
- ZIP task review: PASS; no findings.
- Whole-branch review: one Important atomic-edit defect and one Minor coverage
  gap; both entered the single final fix wave.
- Scoped final-fix re-review: both addressed; no new Critical/Important
  breakage.

There are no parked or residual load-bearing findings.

## Final exact automated verification

Writable sandbox environment was exported separately:

```text
CI=true
XDG_DATA_HOME=/tmp/remediation-xdg
PNPM_HOME=/tmp/remediation-pnpm
```

The exact required chain run on the implementation tree was:

```text
pnpm --filter @workspace/api-server test &&
pnpm --filter @workspace/adventure-zone exec vitest run &&
pnpm run typecheck &&
pnpm run build
```

Fresh final result after the reviewed fix wave:

```text
API:        64 passed files, 2 skipped; 795 passed tests, 49 skipped (844 total)
Web:        20 passed files; 144 passed tests
Typecheck:  library build plus API, web, and scripts exited 0
Build:      API and web production builds exited 0
Overall:    exit 0
```

The only diagnostics were pre-existing non-failing Vite source-map messages and
the existing web chunk-size advisory.

## Commits and changed files

Local evidence commits:

```text
731ec81  fix: preserve canonical phone suppression
09cc890  docs: report phone persistence remediation
1bbf28f  fix: score contact ZIP caller matches
af3c393  docs: record ZIP caller-finder remediation
1f6e422  fix: coordinate atomic primary phone edits
ecec769  docs: report atomic phone edit remediation
```

The exact tested implementation was published through the GitHub connector as
one fast-forward commit:

```text
90d53c1ba567ead3243f4a3623287f18da13d6e0
parent: 7c160576103fce86af8a882ae9ba829960775440
tree:   743be00c28f09814330b259d51655df3364397ce
```

Changed paths and verified Git blob hashes:

```text
945978049ed084ca633f315f185956911d68cda0  .superpowers/sdd/2026-08-12-assisted-calling-workspace/remediation-phones-report.md
9c80abcba849ec4248187282bd8b62d6f2c2141c  .superpowers/sdd/2026-08-12-assisted-calling-workspace/remediation-zip-report.md
5d56fd8d07a78508c930fe92f038dd2ceba0165a  artifacts/api-server/package.json
1482f2fa4c8f86f34b9da90b01e2f1b1d1b2f8a5  artifacts/api-server/src/db/act-review-migrations.test.ts
cf52c58a6344862ab3b4a145992d701b1ace1e18  artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.test.ts
7660ad0d9ae467c27a146cc12c49423561ec3878  artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.ts
0475f9cc97e35b2409e63eb45280346c0f467835  artifacts/api-server/src/features/caller-finder/caller-finder-service.test.ts
04f15d255f9ccc94026882c50aaddf92dea00881  artifacts/api-server/src/features/caller-finder/caller-finder-service.ts
f6144320b66f3d3e7ac514c9c2cd6b662b54363d  artifacts/api-server/src/features/caller-finder/caller-finder-types.ts
aaba9ac792da44e10e4e1f84efcd9423ad969d63  artifacts/api-server/src/features/calls/assisted-calling.integration.test.ts
3b03796a6b2bfce328a1dce77b818fe8362b104c  artifacts/api-server/src/features/contact-phones/contact-phone-repository.test.ts
083d2f0c62c10b0a93b5c73659f193921d5431d9  artifacts/api-server/src/features/contact-phones/contact-phone-repository.ts
1a4cf5e3505b30e45b5e8fdcf45ff3f9f9c09b72  artifacts/api-server/src/features/contacts/contact-repository.ts
23ffb9272c347c0ff53a7da9555d1dfe88a46767  artifacts/api-server/src/routes/caller-finder-zip.integration.test.ts
f8ab325ca3b2aff234d403b70048a0a23fb5278e  artifacts/api-server/src/routes/contacts.atomic-pglite.test.ts
6fa8cb40ded44a926f4dc29241384ec089568ee9  artifacts/api-server/src/routes/contacts.test.ts
19663f7eb90f9ba1ac232bf142afc9120ed6f9e2  artifacts/api-server/src/routes/contacts.ts
c142e0fe6280ac9dc1a9e641c4cbd902f2d24e65  docs/assisted-calling-runbook.md
0db4b91f7ae861ccbe75bc182571958e8757b561  lib/db/migrations/023_contact_phone_canonical_dnc.sql
1491fcc169c7462bbc0e9bf2611b3ec2c73785a0  lib/db/src/migrations.ts
13af0ba3df1b77105a4cbc3ce2bc870aac38439c  lib/db/src/schema/index.ts
0dbb707813caff317bfae6422f6de3e2e82b6751  pnpm-lock.yaml
```

## Remote and main integration verification

Before the ref update, connector comparison confirmed the remote branch was
still identical to authorized head `7c160576...`. The ref moved with
`force=false` only after all 22 connector-created blobs matched local
`git hash-object` values.

After publication:

- the branch was identical to implementation commit `90d53c1b...`;
- all 22 fetched remote file blob SHAs matched the tested local blob SHAs;
- the remote implementation tree was
  `743be00c28f09814330b259d51655df3364397ce`;
- current `main` remained
  `470883df172c7bd8381086bd8f10ebf5323dba09`;
- comparison reported the implementation branch ahead of main and behind by
  zero, with main as the merge base.

This report is published in a subsequent documentation-only commit. Its final
remote commit SHA cannot be embedded in its own content-derived commit and is
therefore returned in the task handoff; its blob SHA is verified after upload.

## Concerns and release status

- No external `TEST_DATABASE_URL` was available. Mandatory PGlite tests execute
  the actual migration SQL, triggers, Drizzle repositories, service, and HTTP
  paths in an embedded PostgreSQL-compatible engine.
- Manual desktop/mobile/accessibility verification, Windows `tel:` handler,
  clipboard permissions, and a configured private voicemail launcher remain
  blocked by the environment and remain release checks in the runbook.
- Migration 023 is additive but was not run against production.
- The assisted-calling feature flag remains false; no deployment or enablement
  occurred.
- One initial connector blob-staging attempt produced only unreachable empty
  blobs because local base64/hash output lacked a delimiter. SHA mismatch was
  detected before any tree, commit, or ref update; corrected staging then
  matched all 22 hashes exactly.
