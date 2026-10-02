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
Baseline gates deliberately retain two ACT failures and three outreach failures; the latter compare both name and first message. OOM/collection/new diagnostic failures are rejected.
Authenticated browser checks at 360px, 768px and desktop are unverified; there is no supported authenticated browser runtime here. No live data is used.

## Read-only review
Local shell provisioning and direct Git/npm access are unavailable. Inspect this exact GitHub range via the repository connector (GitHub compare and fetch-file APIs), not PR #993's older patch. Do not mutate any file, Git ref, PR, issue or working tree. Do not spawn subagents.
Use superpowers requesting-code-review/code-reviewer.md and report strengths, Critical/Important/Minor findings with file/line and effect, every Declined-to-judge behavior with reason, and a clear assessment.
