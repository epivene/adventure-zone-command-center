# Booking date repair whole-branch review package

Repository: epivene/adventure-zone-command-center
Base: 37e71787153018ee366acf642537de97858fdc81
Production/code checkpoint: a63a71acd62178c9ff907e58438d1e77f216aa84
Draft PR: #993 (its branch is synchronized only after this review).
Execution: Native. One fresh whole-branch review; no reviewer subagents and no re-review.

## Binding requirements
Read docs/superpowers/specs/2026-10-01-booking-date-provenance-repair-design.md and docs/superpowers/plans/2026-10-02-booking-date-provenance-repair.md at the supplied review head.
Read every Ruling in docs/superpowers/plans/2026-10-02-booking-date-repair-progress.md.
Delivery is a draft PR. No merge, deploy, live correction, correspondence, paid provider call or connector write-permission expansion.

## Implemented scope
Additive endpoint evidence and JS/SQL resolver; ACT close dates stay sales evidence; effective operational windows and unresolved commitment blockers; source-scoped owner preview/apply with persisted 30-minute previews, allocation mutex, source locks, immutable receipts/audit and idempotent retries; owner queue/review UI, read-only manager/boss evidence and connected query refresh.
Migration never backfills or rewrites booking rows. Fictional fixture stamps are test-only; real planning/calendar/repair writers are tested separately.

## Review Focus (verbatim)
1. Later manual/calendar correction on an ACT-linked booking must outrank old sales evidence (Tasks 1–2).
2. Partial dates and unknown committed windows must remain discoverable and block definitive free-capacity claims (Tasks 1, 3).
3. Verified cross-year and Google exclusive-end windows must survive Denver DST boundaries (Tasks 1, 3).
4. Same-profile multi-season/package records must require exact identity and preserve unrelated records (Tasks 4–5).
5. Concurrent writes, expired previews, duplicate request keys and audit failure must not partially apply (Task 4).


## Additional input classes to deliberately judge
- SQL casts that normalize malformed timestamps versus the JavaScript resolver.
- More than one committed booking with unresolved dates: distinguish saving independent source proof from claiming definitive availability.
- A changed, previously verified signed window: check the documented existing reconciliation path and the conservative guard's actual scope.
- Source-only confirmation, raw timestamp encoding normalization and legacy raw/evidence disagreement.
- Exact saved-source identities and sibling-specific sources, actor namespace, equal-value source revisions, hold expiry, duplicate keys and partial/whole clears.

## Verification
GitHub Actions run 36973212656 at a63a71acd62178c9ff907e58438d1e77f216aa84; package job 110731439059 passes both builds and compares API 104/104 and UI 127/127 diagnostics (zero new).
Focused backend/owner-route checks 88/88 and frontend visibility/repair/role checks 21/21 pass. The operations job 110731438808 passes planning 123, frontend planning 32, operations 79, connected views 73 and shared 6; both compatibility gates pass.
Baseline gates deliberately retain two ACT failures and three outreach failures; the latter compare both name and first message. The package gate rejects OOM/non-diagnostic/new diagnostic failures. The capacity gate rejects collection/runtime failures; the ACT gate compares failed assertion names and has the deferred limitation recorded below.
Authenticated browser checks at 360px, 768px and desktop are unverified; there is no supported authenticated browser runtime here. No live data is used.

## Read-only review
Local shell provisioning and direct Git/npm access are unavailable. Inspect this exact GitHub range via the repository connector (GitHub compare and fetch-file APIs), not PR #993's older patch. Do not mutate any file, Git ref, PR, issue or working tree. Do not spawn subagents.
Use superpowers requesting-code-review/code-reviewer.md and report strengths, Critical/Important/Minor findings with file/line and effect, every Declined-to-judge behavior with reason, and a clear assessment.

## Final independent review record

Reviewed exact base `37e71787153018ee366acf642537de97858fdc81` through `41e316da95c9010f796424ad206ad2750458911a`, including every Ruling and existing reconciliation paths. Reviewer independently read successful checkpoint jobs; no tests were independently executed. Strengths: additive immutable evidence, transaction/mutex/source locking, conservative operational readers, meaningful concurrency/rollback/DST/identity/UI tests. Initial verdict: **No—fixes required**; no Critical findings.

Re-graded Important findings and ONE fix pass:
1. Multiple unresolved commitments mutually blocked recording date proof. Changed unknown-other-booking reasons to warnings for source recording; operational availability remains incomplete. Regression repairs two commitments sequentially with status preserved.
2. Previously verified signed windows lacked a usable reconciliation completion condition. Added an explicit second owner reconciliation preview with exact prior/proposed windows and obligation IDs. Existing active obligations still block; Apply validates proposal, sources and snapshot under the mutex; proof-window clearing remains blocked. Regression covers assignments, stale sources and unchanged signed status; UI requires the explicit reconciliation action and clears authorization on edits.
3. Legacy ACT snapshots could not bootstrap their own classification. Discover and authorize versions using exact booking external links/imported-field origins, database namespace and immutable version identity. Lock/fingerprint linkage rows. Regression starts with zero endpoint evidence and excludes sibling snapshots.
4. JavaScript/SQL accepted different instant ranges. Enforce identical strict clock/offset component ranges before normalization. Regression covers unsupported offsets, second 60, hour 24, supported equivalent values, and ordinary instant apply/SQL readback.

RED checkpoint [36974701106](https://github.com/epivene/adventure-zone-command-center/actions/runs/36974701106), job110735890153: nine backend and one frontend failures reproduce these issues. Whole-task GREEN verification is tracked below.

**Final: minor (deferred):** ACT broad compatibility gate lacks collection/runtime/report completeness checks and compares names without multiplicity/cause. Current successful run collected and executed tests; future collection errors or identical-name changed causes may be hidden. Native requires deferring Minor findings rather than expanding this fix pass.

Declined-to-judge items all have Rulings and costs in the progress ledger:
- Authenticated 360px/768px/desktop usability: unsupported authenticated runtime; remains unverified.
- True dates of 18 live historical records: outside draft-delivery authorization; source review remains outstanding.
- Automatic attachment interpretation: explicitly outside the approved saved-note/document-note workflow; explicit ISO notes may be needed.

No further reviewer was dispatched and no re-review was performed. Executor verification, not an additional reviewer verdict, determines completion of the single fix pass.

Final-fix verification attempt1 at `683c7c5376e06067de3e7e198ce23a6dc4091e7f`: backend94/94; frontend22/22; shared6/6; planning123/123; planningUI32/32; operations79/79; both builds and zero-new package diagnostics pass. Connected views72/73: immediate BookingDetail assistant-context assertion observes zero calls before the registration effect; no relevant component change in this fix pass. Re-run only the failed operations job once at the unchanged commit. Retain this failed attempt in the record.

## Executor final verification

[Run 36975066885](https://github.com/epivene/adventure-zone-command-center/actions/runs/36975066885) attempt2 at `683c7c5376e06067de3e7e198ce23a6dc4091e7f` is SUCCESS; operationsjob110738749778 and packagejob110738750888 pass. Backend94/94, frontend22/22, shared6/6, planning123/123, planningUI32/32, operations79/79 and connectedviews73/73 are green. Both builds/shared typecheck pass, API104/104 and UI127/127 diagnostics add zero errors, and broad gates retain exactly two/three baseline failures. The unchanged retry passes the immediate assistant-context assertion from attempt1. All four Important findings are addressed and verified; the one Minor is deferred. No re-review was performed. Current main added eight unrelated Today/call-list files; no overlap, combined integration unverified. Synchronize existing draft #993 with this tested code and docs-only completion records; preserve draft and stop before merge/deployment/live correction.
