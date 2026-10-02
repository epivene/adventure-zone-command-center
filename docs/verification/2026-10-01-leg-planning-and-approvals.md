# Leg planning and approvals verification

Approved scope: [design](../superpowers/specs/2026-10-01-leg-planning-and-approvals-design.md) and [implementation plan](../superpowers/plans/2026-10-01-leg-planning-and-approvals.md). This delivery is a draft PR, without merge, deployment, customer correspondence or live inventory repair.

## Result and evidence

The feature adds real season staffing, incomplete event drafts, verified physical package composition, sourced availability/travel/lodging, attributed exact-plan approvals and atomic commitment. The same server readiness feeds booking/profile, schedule/map, routes and manager/Dave views. Drafts reserve nothing; commercial status and task completion remain separate.

Executed with Node 22.23.2 and installed pnpm 11.25.0; CI specifies Node 22 and pnpm 10. No dependencies or lockfile changed. Initial implementation baseline corresponds to main `4536a686aa025468dc1ae92adf3ad72248d4eeae`; the seven independent Com decision-review files from main `cd14ca83d48b59ac06ea9a05a26648343fb2b3f5` were preserved before final review. Published commits use actual remote main ancestry, not the synthetic local history.

| Check | Local result |
| --- | --- |
| New planning backend, auth/startup and affected connected-operations API tests | 33 files passed, 214 tests passed; one PostgreSQL file/four tests skipped |
| New editors/client plus affected connected operations interface tests | 29 files passed, 103 tests passed; additional Boss contact-editing file: five tests passed |
| Shared operations contract | Passed, three tests |
| Shared-library typecheck | Passed |
| Frontend and API production builds | Both passed on Node 22 |
| Application TypeScript checks | Existing baseline errors remain; comparison recorded below |
| Disposable PostgreSQL concurrency/rollback/guard checks | Unperformed locally: postgres, pg_ctl and docker unavailable; dedicated CI service configured |
| 360px, 768px and desktop browser checks | Unverified: cloud browser rejected local preview with `net::ERR_BLOCKED_BY_CLIENT` |

Tests cover source-window semantics and DST/year boundaries; full availability coverage and unavailable precedence; real shared physical resources; capacity limits; Dave binding changes; exact parent-manager authority; two-AZ strategic acknowledgement; separate split/extra grants; stale revisions; mismatched idempotency bodies; atomic split rollback; guarded legacy writers; scope/privacy; late responses after event switching; preserved drafts during refresh; pending/failed reads blocking commitment; contextual navigation; ambiguous historical records and partial section failures.

The CI workflow uses PostgreSQL 16 in a disposable loopback database and enables the planning receipt guards. PGlite results are deterministic policy/persistence checks and do not prove real concurrent locking. Do not treat the four skipped tests as passes.

## Typecheck comparison

Shared libraries pass. The interface has 127 diagnostic instances versus 132 on the clean baseline, with no new diagnostic locations/codes (union-member presentation can differ); explicit boolean state in the touched settings form removes five existing instances. The API has 104 diagnostic instances after correcting two introduced test/transaction typing issues, versus 104 on the clean baseline. Union-member display ordering is normalized when comparing equivalent diagnostics. Neither full application typecheck is claimed green.

## Release and operations limits

Actual verified inventory, staffing requirements, availability, transport, accommodation and the Dave account binding still require onboarding. Historical ambiguous years/dates are retained; this feature does not repair the calendar. All new controls are server-capability gated. See [onboarding](../operations/leg-planning-onboarding.md).

Additional affected trip/crew regressions passed: four files, 18 tests. The preserved Com decision-review unit/MCP suites passed. Its connection-flow integration test still fails on an existing null operation receipt; the identical failure was reproduced on clean updated main. The complete outreach-allocation suite reproduces the same two active-pursuit reranking failures on this branch (52 passes, including the new legacy-writer test) and clean updated main (51 passes). These existing failures are reported, not suppressed or changed by this feature. The planning-specific legacy-writer regression is tested separately.

Whole-branch review and GitHub CI evidence are recorded below; current workflow status is linked from draft PR#991. Local blocked browser verification remains a release check.

## Rulings made during execution

- Ruling: Use the existing isolated linked worktree and connector-synchronized current-main snapshot; publish GitHub tree/commit with actual current-main parent rather than synthetic local ancestry — the existing checkout has synthetic history and no git remote — cost if wrong: a mismatched baseline must be reconciled before PR creation.
- Ruling: Reuse installed dependencies and explicit Node 22 binary; installed pnpm is 11.25.0, while CI uses pnpm 10 — no dependencies are changed and the existing lockfile is preserved — cost if wrong: rerun commands under CI's pnpm version.
- Task 2: Ruling: Add optional sourced travelReview/loadInAddress to the draft and an endpoint fingerprint to travel facts — existing trip route confirmation proves chosen stop order, not verified transfer feasibility; explicit review must become stale when endpoints change — cost if wrong: adjust the review form/API contract before merging. Task 5 stamps review time server-side; Task 7 exposes review after saving the current locations.
- Task 3: Ruling: Add a half-open instant capacity evaluator beside the existing inclusive-date evaluator — rounding operational timestamps to the legacy Chicago/date-only policy would create false overlaps — cost if wrong: reconcile boundary behavior before enabling commitment writes. Legacy callers are unchanged.
- Task 3: Ruling: A sufficient proposed crew awaiting confirmation is Needs details, while a plan with too few proposed/confirmed workers or missing required roles is Conflict — unconfirmed availability is unknown rather than proof of understaffing — cost if wrong: adjust the displayed classification; both states prevent commitment.
- Task 5: Ruling: Bind group approvals to a sorted digest of every branch's authoritative fingerprint, with canonical date instants and server audit timestamps/revisions excluded from material evidence — a decision must be identical for both branches and survive its own canonical commit or identical save — cost if wrong: adjust the fingerprint migration before rollout and require fresh review.
- Task 5: Ruling: Share the existing mutex/receipt tables in the additive migration and add planning receipt guards to trips and crew inventory; route crew factual changes through reconciliation too — those writers can change actual feasibility while outreach is disabled — cost if wrong: a missed writer fails closed until brought into the shared boundary.
- Task 5: Ruling: Only a currently approved, unchanged committed extra physical allocation supplies a dated extra-capacity grant to other normal bookings; proposed drafts supply no grant/reservation — a sixth/fourth event needs one actual extra set, not repeat approval of every normal set — cost if wrong: adjust the grant projection and request fresh decisions before commitment.
- Task 5: Ruling: Preserve exact committed crew shifts and explicit linked trip identities in internal obligations — a route's own equipment and off-shift crew are not competing reservations — cost if wrong: tighten the explicit linkage and invalidate affected travel reviews.
- Task 6: Ruling: Preserve existing disabled-account authentication response 401 rather than introduce 403 — invalid sessions already use the established middleware contract — cost if wrong: adjust the client and route expectation together.
- Task 6: Ruling: Managers can use only office-assigned package sets/transport and current leg-membership workers — global physical inventory has no reliable manager membership boundary — cost if wrong: introduce explicit leg inventory membership before expanding manager selection.
- Task 6: Ruling: Embedded read summaries expose readiness with all edit/decision actions false; the authenticated planning endpoint supplies authoritative actions — the older summary viewer carries no verified audit principal — cost if wrong: propagate a real principal before embedding action permissions.
- Task 7: Ruling: Expose exact split group identities and request-specific decision permission in the scoped read — the editor must recover a partially saved draft preparation and distinguish manager split authority from Dave-only extra-set authority — cost if wrong: revise the additive read contract and recovery controls before rollout.
- Task 8: Ruling: Publish one broad operations refresh for planning mutations, alongside exact affected IDs and recorded leg/season metadata — changes can alter neighbor conflicts absent from a receipt, and existing consumers already understand '*' — cost if wrong: extra scoped reads; introduce a dependency index before narrowing invalidation.
- Task 8: Ruling: For an unsaved plan on a year-9999/invalid historical record, use the current valid year as an editable initial proposal while retaining unresolved-date reasons and every canonical date unchanged — invalid placeholder years otherwise make the new editor's strict contract unreadable — cost if wrong: make draft season nullable and require explicit choice in the contract.
- Task 8: Ruling: Selected transport must have an explicitly recorded transport category (vehicle/truck/van/bus/trailer/camper/RV/transport); an available pool cannot satisfy transport — real physical identity alone does not establish transport capability — cost if wrong: extend the category mapping or add an explicit verified transport-kind field.

- Task 8: Ruling: Use the approved focused new/affected suites as the delivery gate and report reproduced unrelated baseline failures explicitly — fixing Com receipt behavior or older outreach advancement is outside this leg-planning change — cost if wrong: a broader integration defect requires a separate fix before release.

## Whole-branch review

One fresh read-only gpt-6-astra review identified seven Important findings and no Critical or Minor findings. Each was reproduced by a failing regression, then corrected in one fix pass: physical items shared across simultaneous selected sets, Dave session lifecycle, immutable fresh approval cycles, reviewed wider reservations, actual December/January branch commitment, scoped embedded manager summaries and the binding editor revision. Focused reproductions passed (42 backend and eight editor tests); the final broadened gate passed: 214 backend tests, 103 interface tests, three contract tests, library typechecking and both Node 22 builds. PostgreSQL tests remain skipped locally.

### Final rulings and deferred minors

- Final: Ruling: The selected December season may include the exact split's canonical January-start branch in the immediately following year, only when both canonical public starts are December/January across that boundary and both saved branches use the same selected season — this realizes the explicitly approved New Year workflow without globally relabeling booking years — cost if wrong: revise the boundary-season rule and require fresh review of affected groups.
- Final: Ruling: Approval fingerprints use the reviewed working reservation while it contains the canonical reservation; canonical public dates remain independently fingerprinted, and an externally longer reservation still invalidates readiness — commitment's intentional reservation expansion must not invalidate its own unchanged reviewed plan — cost if wrong: narrow the effective-window rule and require fresh decisions for affected plans.
- Final: Ruling: Real PostgreSQL locking — require the disposable CI concurrency/rollback/guard checks before release; PGlite alone is insufficient — cost if wrong: correct transaction locking and rerun CI.
- Final: Ruling: Actual 360px/768px/desktop usability — retain the explicitly blocked visual checks as unverified and required before release — cost if wrong: fix layout issues found in supported preview.
- Final: Ruling: Production inventory/staffing/accommodation/Dave identity — complete the authorized app workflow and leave real operations onboarding to verified facts; create no invented data — cost if wrong: correct the recorded onboarding facts before commitments.
- Final: Ruling: Calendar-wide historical repair — preserve canonical historical records because separate repair is excluded — cost if wrong: perform a separately reviewed source reconciliation.
- Final: Ruling: Connector read/write delivery — retain existing connector contract/scopes and deliver app controls only — cost if wrong: scope and review a separate connector change.
- Final: Ruling: Correspondence/merge/deployment — finish only a draft PR because the approved delivery stops there and messages need Desiree review — cost if wrong: obtain explicit authority for the next external action.
- Final: Ruling: Existing Com receipt/outreach reranking failures — report matching clean-main reproductions and keep unrelated repair outside this feature — cost if wrong: repair a discovered integration dependency before release.
- Final: Ruling: Full application TypeScript cleanup — require no new diagnostics relative to clean main and report the existing errors — cost if wrong: fix newly attributable diagnostics before delivery.
- Final: Ruling: Manual sourced travel review — retain explicit endpoint-matched review and server-stamped evidence without provider calls as approved — cost if wrong: revise the travel-evidence workflow before commitment.

Deferred minors: none.

## First GitHub CI run

[Connected Leg Operations run36960569900](https://github.com/epivene/adventure-zone-command-center/actions/runs/36960569900) executed all four real PostgreSQL cases successfully (2.483s for that file), establishing actual concurrent claim, competing hold, rollback and guard evidence. The step later failed on a5s timeout in the PGlite manager-receipt privacy test. That test keeps every assertion and now has a specific15s allowance for its included cold setup.

Boss Unified Documents exposed an older BossProfileContactEditing mock missing bossFetch after the new planning import. Cleanmain passes its5tests; the branch reproduced the missing-export failure RED, then adds the actual mocked export. Other workflow failures include existing root-runner alias/database/jsdom issues, older route-mount string checks, office draft fixture columns and manager-map expectations. Three relevant route-mount/map failures were independently reproduced on cleanmain. The entire repository CI is not claimed green.

- Final: Ruling: Allow15seconds for the PGlite receipt-scope integration test including cold database setup — CI's two-CPU runner exceeded5seconds while all four actual PostgreSQL cases passed — cost if wrong: measure and reduce fixture/setup cost rather than masking a performance defect.

The CI corrections passed locally: Boss contact editing5/5 and receipt privacy2/2. No application behavior changed in this follow-up. The refreshed PR reruns GitHub checks.
