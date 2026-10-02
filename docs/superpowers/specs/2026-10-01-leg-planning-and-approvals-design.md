# Leg staffing, equipment and approvals

Date: October 1, 2026 (Adventure Zone local date)
Status: Written design for Desiree's review; this extension is not implemented.
Repository: epivene/adventure-zone-command-center
Source inspected: merged main `03dd72044e1ec51ac28768a82b41846e918617dc`, including connected operations PR #988.

## Outcome and scope

Finish the operating workflow behind the connected leg views: Desiree can prepare a leg's season plan, assign actual crew and equipment to an event, resolve conflicts, request the required approval, and see the resulting plan consistently in bookings, profiles, schedule, map, routes and the relevant manager view. Dave sees the same operational facts with a simple presentation and permission-appropriate controls.

This is one booking-centered planning extension. Historical calendar repair remains a separate project; uncertain history is visible evidence and does not prevent recording a new, verified plan. Customer correspondence still requires Desiree's review and explicit instruction to send. This design includes no automatic messages, paid AI calls, live booking changes, merge or deployment.

Success means the app can save and evaluate a real plan. It does not mean every leg is staffed: actual workers, equipment, transport and accommodation must be entered and verified before readiness can be established.

## Existing facts and gaps

The nine current planning slots are Dave, Hulk, Kristy, Mikey, Angel, Jeremy (tentative), and three unfilled slots. Angel and archived Angelo remain separate; Jeremy is not assumed to be archived JR. Mouth is excluded from current assignments and preserved in history.

Read-only inspection found the normal capacities correctly saved: five Adventure Zone, three Pirates, one Warrior. These numbers are limits, not verified physical inventory. The resources read returned one entry named **Test**, so the app currently does not establish complete physical package sets. Do not manufacture resource identities or claim the real business has only one piece of equipment.

Existing crew workers, membership and work history provide identities and past experience; they do not establish current availability or staffing requirements. Leg defaults have no verified base or vehicle information in the inspected roster. Existing special-request decisions and free-text conflict acknowledgements do not establish authenticated Dave or manager approval.

The deployed connected view already distinguishes saved legs, suggestions, prior seasons, public and reserved dates, resource warnings, route context and task progress. Extend that service and existing editors. Keep customer booking status, task completion and operational readiness separate.

The connector's 2027 booking filter returned 20 rows, 18 with 2026 starts and year-9999 ends. It is not a reliable inventory of 2027 events. Invalid or ambiguous dates require review; do not automatically assign those bookings or rewrite their history.

## Approach

Extend existing leg management at `/operations/legs`, the booking operations service, crew records and canonical resource allocations. New records represent the missing planning and approval facts; they reference existing booking, worker, resource and leg IDs.

A separate planner would duplicate the schedule and resource ledger. A calendar-first expansion would improve date visibility but leave staffing and approval unresolved. Extending the current booking-centered system keeps one saved assignment and one set of facts across screens.

Deliver the cohesive workflow in three implementation slices: saved operating plans and scoped views; shared readiness and reservation enforcement; attributed approvals and integrated review/commit controls. Each slice must preserve the rules below. Calendar-wide reconciliation and new connector mutation tools are outside this design.

## Saved planning records

### Season and event plans

A leg-season plan references a current leg and an explicit season. It records leadership state (confirmed, tentative or unfilled), the actual responsible manager where known, crew membership references, base and transport defaults, and revision metadata. Preserve Jeremy's tentative state and the three unfilled slots until an operator deliberately updates them. Do not automatically create named crew workers from leg labels.

An event operations plan references one canonical booking and its leg. It records proposed or confirmed crew assignments, physical equipment, transport, accommodation and requirements. Its revision is separate from commercial status. Saving an incomplete draft is allowed. Committing an operating plan validates the applicable facts and reservations; it does not confirm a customer booking or send a message.

There is no second canonical booking-leg assignment. The existing booking field remains authoritative; draft proposals identify the proposed leg explicitly. An accepted plan updates that field and existing allocation tables through shared services in one transaction.

### Crew

Use existing worker IDs. Add dated availability with confirmed, unavailable or unverified state and source, plus event assignments containing role, working window and proposed or confirmed state. Historical work and rehire eligibility remain separate evidence. A worker cannot be confirmed for overlapping obligations merely because the events have different legs.

Record required crew counts and roles for each operating plan, entered by an authorized operator. Do not invent a universal minimum. Missing requirements or insufficient confirmed staff produce Needs details or Conflict respectively. A proposed assignment does not imply that the worker accepted it. Unavailable workers and do-not-rehire workers cannot be committed as confirmed crew through this workflow.

### Physical equipment, transport and accommodation

Reuse existing resources as the identity of physical items. Package-set definitions group real resource IDs, package type, verified composition and revision. An unverified planned set is distinguishable from a complete verified set and contributes no verified availability. Moving an item between bundles does not create another item.

Operators configure required composition and verify the actual five normal Adventure Zone sets, three normal Pirates sets and single Warrior setup. Additional Adventure Zone or Pirates equipment is recorded by its actual IDs and verified composition. The extra Pirates pool is evidence to collect, not an assumed complete fourth set. MiniZone remains governed by its existing package configuration; its count of five attractions does not establish five physical sets.

Vehicles, trailers and campers use the same physical resource identity system and dated assignment windows. Track a shared paintball trailer by one ID across legs and trips. Record lodging requirement, capacity where relevant, dates, location and reservation/source reference; use Not recorded when unknown. Accommodation can be explicitly marked unnecessary with a reason. Never infer accommodation from historical notes or vehicle defaults.

Booking and linked-trip allocations of one resource are reconciled by canonical obligation identity, not counted twice. Distinct bookings sharing the same resource remain competing obligations.

## Dates, conflicts and readiness

Use a shared operational-window resolver. Preserve public event dates separately from reserved dates and optional verified arrival, setup, operating, teardown and departure windows. Longer real reserved windows win over generic buffers. Preserve timestamp intervals, inclusive local business dates and Google's exclusive all-day ends according to source semantics; do not perform a global calendar timezone migration here.

Missing dates, year-9999 sentinels, end-before-start and contradictory seasons yield Needs review. Unknown endpoints and travel/transfer times cannot prove feasibility. Stored estimates show their source and age; route-provider calls remain explicitly requested and bounded.

Evaluate current authoritative allocations, confirmed obligations and active holds using existing canonical identities and hold lifecycle. Deduplicate mirrored records. Returning-customer expectations remain labeled planning evidence rather than invented hard reservations. Pending plan drafts are not holds unless the operator uses the existing explicit hold action.

Readiness has separate crew, equipment, dates/travel, accommodation and approval dimensions, with evidence references and next actions. Overall states are:

| State | Meaning |
| --- | --- |
| Conflict | A known staffing, resource, transfer or capacity conflict exists. |
| Needs review | Evidence is contradictory, stale, unavailable, or an approval is pending or invalidated. |
| Needs details | Required facts have not been recorded or verified. |
| Verified plan | All required dimensions pass against current facts for this exact revision and window. |

Use that precedence when several states apply. Verified plan is time-stamped and recomputed when relevant facts change; it is not a permanent availability guarantee. Missing history, an empty calendar, completed tasks, package limits or an existing leg assignment never establish readiness.

Existing resource warnings and acknowledgements remain visible. A generic acknowledgement can document awareness but cannot waive physical overlap, unavailable equipment, insufficient staff, duplicate Warrior use or the approval rules below.

## Splits and exceptional capacity

| Rule | Enforcement |
| --- | --- |
| Adventure Zone | Five simultaneous complete sets normally; a sixth requires Dave's approval and a verified equipment/staffing plan for the affected dates. |
| Pirates | Three normally; a fourth requires Dave's approval and verified additional equipment/staffing. |
| Warrior | One physical setup; no simultaneous duplicate and no override. |
| Leg split | Dave **or the relevant leg manager** approves the exact two-site plan. |
| Strategic split | Prefer Adventure Zone plus a smaller Pirates or Warrior package. Two full Adventure Zone events require explicit strategic review, not an automatic prohibition. |
| Independent decisions | Split approval neither creates resources nor approves a sixth Adventure Zone or fourth Pirates set. |

Capacity exceptions are bounded to six Adventure Zone and four Pirates; they are not unlimited increases. Check peak simultaneous package usage over the affected windows, including other legs. Package selections describe demand while complete physical sets establish supply.

A split group retains the parent leg and references both bookings. Each branch records its own crew, resources, transport, accommodation and working window. Compare required staffing with actual assigned workers; do not automatically halve the crew or assume either half is enough. No worker or physical item can serve simultaneous branches without a feasible non-overlapping transfer plan.

For two Adventure Zone branches, the approving Dave or relevant manager must explicitly acknowledge reduced staffing and verify each branch's requirements. Do not introduce a Dave-only split requirement where the user authorized the relevant manager. Separate extra-capacity approval is still Dave-only.

## Authority, decisions and changes

Approval authority is derived from authenticated server-side identities. Owner configuration binds Dave authority to a specific enabled existing boss account; never infer it from display name, a client-supplied approver or the generic boss/owner role. Relevant manager authority comes from the authenticated manager's authorized parent leg. Until Dave's account binding is configured, a Dave-only request remains pending.

An owner can prepare and request decisions. Notes reporting a phone conversation are supporting evidence, not authenticated approval. This release requires Dave or the relevant manager to submit the decision in their authorized view.

Append-only decision records store request type, decision, authenticated actor, timestamp, reason, affected bookings/windows and a fingerprint of the reviewed plan. Requests display what is being approved, current conflicts, missing facts and exact branches or additional set. Reject approval while required equipment or staffing evidence is missing or a hard conflict exists.

Material changes to dates, leg, package demand, crew, equipment, transport, requirements or verified composition invalidate the applicable decision. Revocation and disabled authority are visible. Reevaluate changed neighboring obligations and holds at commit and during readiness reads; approval cannot preserve feasibility against a newly conflicting obligation. No-op edits retain valid decisions. Keep the decision history and explain why a fresh review is needed.

## Writes, concurrency and access

The shared service validates readiness and authority on the server and returns structured conflicts. Use expected revisions and stable mutation IDs. Commit canonical assignment/allocation updates and planning records atomically, locking overlapping leg, worker, physical-resource and package-capacity scopes in a consistent order. Concurrent commitments cannot both succeed when only one is feasible. Retry returns the original receipt rather than duplicate assignments or decisions.

An approved split is a narrowly scoped exception to same-leg overlap, only for its referenced branches and still-valid plan. It is not a general ignore-conflicts flag. Shared physical and crew constraints remain enforced.

Route canonical booking, resource, trip and affected hold writers through shared validation or plan invalidation as appropriate. Legacy customer-status/date edits remain possible, but produce an explicit invalidated plan and conflict rather than silently retaining Verified plan. Any writer creating a confirmed crew/resource obligation must enforce hard constraints in the same transaction. Inventory or availability changes may expose an existing conflict; show it and invalidate readiness rather than pretending the change did not occur.

Managers can read and prepare plans only for authorized legs and bookings. Other-leg conflicts disclose that a worker/resource is unavailable, not unrelated customer identities, rosters or accommodation. Owner and boss views share factual results; controls respect their respective authority. A section failure displays Unavailable with retry while independent sections remain usable.

## Daily app flow

Leg cards show selected season, manager state, recorded crew/equipment/transport and missing setup. Opening a card shows its dated obligations and unresolved operating plans. Existing crew and resource editors remain the places to maintain real identities.

From a booking or profile: select the event/year, inspect previous-season evidence, choose a proposed leg, fill dates/crew/equipment/travel/accommodation, and review the shared readiness result. Request Dave or manager approval where needed, then commit the validated plan. Clear next-action links take the operator to the missing fact or pending decision.

Schedule, map and route use the same booking/leg/season and readiness summary. Assignment commits and relevant edits invalidate affected caches, including neighboring conflict results. Keep unassigned and unmapped lists visible. The manager's plan and checklist reference the same facts; checking a task does not approve a split or make a plan ready.

Use stacked cards on phone widths and a concise operational summary for Dave. Show expanded evidence on demand rather than placing audit details in the normal workflow. Existing connector reads remain unchanged; adding a shared scoped read tool or reviewed write tools requires a separate connector delivery scope.

## Migration, verification and completion

Use additive schema changes and the repository's startup/schema-check patterns. Existing bookings and history survive unchanged. Old bookings display Not recorded for new fields; no fabricated crew, package-set inventory, approval or readiness is seeded. New enforcement must fail closed when its required schema or authority configuration is unavailable. Release independently deployable slices with controls hidden until their server capability is available.

Required checks cover:

1. Exact current/archive identities, season isolation and preservation of customer status/history.
2. Incomplete drafts, real crew requirements, worker overlaps and proposed versus confirmed availability.
3. Package-set composition, shared trailer transfers, canonical booking/trip deduplication and resource maintenance.
4. Five/six Adventure Zone, three/four Pirates and hard single-Warrior limits over actual overlapping windows.
5. Dave-only extra sets, Dave-or-relevant-manager splits, unauthorized decisions and two-Adventure-Zone strategic review.
6. Fingerprint invalidation, revocation, neighboring obligations, no-op edits and legacy writer invalidation.
7. Inclusive/exclusive dates, longer reserved windows, sentinel dates and unavailable/stale route evidence.
8. Competing concurrent commits, stale revisions, transactional rollback and idempotent receipts.
9. Scoped manager privacy, partial failures, matching facts across all views and refresh after edits.
10. Usable layouts at 360px, folded/unfolded phone widths and desktop, with actual browser verification recorded separately from component tests.

Run affected database/API/UI checks and production builds. Report pre-existing unrelated failures and unperformed browser checks honestly. Do not use live customer changes or paid calls as tests.

Completion requires functional editing, server validation, approval requests/decisions, consistent connected views, passing focused checks and a reviewable draft PR. Real operations onboarding then verifies the Dave account binding, crew/role requirements, actual equipment sets, transport and accommodation. A functional app and a fully populated ready season are separate outcomes.

## Design self-review and handoff

Self-review: no placeholder sections; rules distinguish splits from extra capacity, drafts from obligations, history from current availability, and authenticated decisions from notes. New tables serve the one leg-plan workflow; calendar repair and connector mutation work are explicitly excluded. Unknown business data is an explicit setup requirement, not an invented default.

This written spec is ready for Desiree's review. The architectural workflow requires written-spec approval before an implementation plan is prepared, followed by review of that plan and selection of its execution method. No product implementation is claimed by this document.
