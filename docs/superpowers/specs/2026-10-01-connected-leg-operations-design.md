# Connected legs and booking operations

Date: October 1, 2026
Status: Written spec for Desiree's review. Product implementation has not started.
Repository: epivene/adventure-zone-command-center
Inspected source: 16f8896e96b0ef8c424a73ce47328ada824a2464

## Intended outcome

Desiree should be able to open an event, see which leg handled it in the previous season, evaluate a leg for the new season, and see what remains to arrange for crew, equipment, transport, campers or lodging, and approvals. A saved assignment must be reflected consistently in the booking, profile, schedule, map, route, and relevant manager view.

The booking for a particular event and season is the center of these connections. A customer profile can have several bookings and years. Changing the selected year must not replace or rewrite history.

This document specifies a focused first release and the boundaries for later releases. It does not authorize publishing, merging, sending correspondence, granting connector permissions, or changing live bookings.

## Existing foundation and evidence

- The live roster has nine current planning slots: Dave, Hulk, Kristy, Angel, Mikey, Jeremy (tentative), and three unfilled slots. Historical records remain archived. Angel and Angelo are different people; Jeremy must not be merged with JR without confirmation.
- Normal package capacities are saved as five Adventure Zone, three Pirates, and one Warrior's Playground. A manager slot is not a physical package set or a verified available crew.
- Existing leg-assignment code uses prior-year ownership, route feasibility, workload and travel estimates. Some paths automatically save assignments. An assignment from this logic does not establish equipment, crew, lodging or approval readiness.
- Existing operations-summary code already combines leg, package selections, resource warnings and pending special requests. Extend the established summary and resource services; do not introduce a second conflicting operations system.
- Operational connector reads exist for saved legs, bookings, holds, resources, crew history and routes. Their limitations distinguish history from availability and stored estimates from verified travel plans.
- The saved calendar inventory contains 123 event/package rows for 2025–2026. Several package rows can describe one physical event. Historical imports have not been fully reconciled: an attempted import returned GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED despite a Connected badge.
- The October 1 shared booking work-queue design covers responsibility, progress and next actions. Operational readiness must remain separate from task completion and commercial booking status.

The package limits and strategic split guidance were recorded in notes. That is not evidence of a complete structured approval workflow or automatic enforcement.

## Selected approach

Extend the existing booking operations summary into a shared, server-produced view consumed by the booking panel and related screens. Use existing booking, leg, resource, reservation, route and work records as canonical sources.

A calendar-first approach would make the operational timeline familiar but leave crew, equipment and approvals scattered. A new independent operations subsystem would duplicate existing records and require a larger migration. Extending the booking-centered foundation gives the shortest path to a useful daily workflow while preserving the existing app.

## First release: connected view and consistent navigation

The first release adds a Leg & Operations panel to the booking detail and the selected booking/year on its profile. It assembles saved evidence, exposes missing information, and links to existing editors. It is not a complete new availability engine, importer, crew scheduler or approval system.

| Panel area | Required behavior |
| --- | --- |
| Previous season | Show matched prior booking(s), season, historical leg, package and source links. Distinguish the immediately previous season from an older last-known visit. |
| Current leg | Show the saved assignment separately from the saved suggestion, explanation, confidence and any stored travel warnings. Link to existing leg selection controls. |
| Route and dates | Show public event dates separately from the operational reserved window, previous/next saved stops and available route estimates. Missing estimates and unresolved dates remain visible. |
| Package and equipment | Show selected packages separately from actual allocated resources. Surface existing conflicts and pending special requests, with links to resolve them. |
| Crew and campers | Display verified current-season assignments only where existing records support them. Otherwise show Not recorded and a clear next action. Historical crew work is labeled history. |
| Next action | Show missing details and related shared-work items with links. Completing a task must not mark operations ready or a booking confirmed. |

Use compact stacked sections and readable cards on folded and unfolded Galaxy Fold widths. Avoid wide tables in the product UI. Keep the profile's selected booking year visible so the user knows which season is being changed.

### History matching

Prefer the same event profile and an existing explicit event-family relationship. A shared organizer alone is not sufficient to assert that two bookings are the same event. When more than one historical booking is relevant, show the evidence and dates rather than choosing an owner silently. Preserve multiple legs for a multi-package event where the sources show them.

Archived legs remain visible in history and are not suggested as current candidates. Jeremy remains tentative and unfilled slots remain unfilled; the view must not describe either as fully staffed. Calendar-only evidence must be labeled as such until reconciled with saved booking records.

Use the existing calendar import/reconciliation workflow for approved repairs. The first release exposes connection failures and reconciliation gaps and supplies source links; it does not automatically create profiles or promote historical/calendar entries into new-season commitments. Preserve original source identities, reserved windows and Google exclusive end dates.

### Shared data and navigation

Keep the booking ID and travel-leg ID as the existing canonical links. Extend the operations summary with bounded prior-season evidence, date windows, suggestion details, completeness indicators and source links. Do not copy entire email threads or notes into the summary.

Schedule, map, route and manager navigation must open the same booking and leg. Within a combined schedule/map workspace, use one explicit season and consistent status filters. Across separate pages, carry those filters in navigation and display them clearly. Include an explicit unmapped/unassigned list: an absent pin is not evidence that a leg is free.

After a successful existing assignment edit, invalidate the affected booking/profile summary and schedule/map/route data. Reloading must show the same saved assignment. The panel does not add a second assignment editor or new mutation path in this release.

Show existing automatic assignments as saved assignments with their source and unresolved readiness details. Do not silently erase manual assignments, change automatic-assignment policy, or convert a suggestion into a hold or resource allocation.

### State and failure handling

Keep commercial status, saved leg assignment, proposed suggestion, reservation/hold status, task progress and operational completeness separate. A confirmed customer booking with missing logistics remains confirmed and visibly needs operational work.

In this release, use factual labels such as Assigned, Suggested, Conflict found, Needs details and Not recorded. No green Available or Ready verdict may be inferred from an empty query, a route score, package capacity, crew history or an expired hold.

One failed summary section must not make the whole booking disappear. Show that section as Unavailable with retry and keep other independently verified sections visible. A missing Google authorization is a connection problem, not an empty calendar. Distinguish no matching history from history not reconciled.

Reads must honor existing access controls. Dave should see the same operational facts and comparable layout as the admin, with controls governed by his permissions. Managers receive their authorized operational view, without exposing unrelated customers or crew records.

## Later release: staffing, physical allocation and approvals

This is a separate spec/plan cycle after the first release. It adds or extends structured current-season crew availability, roles, vehicle/camper assignments, lodging requirements and approvals only where the existing models are insufficient. Do not invent crew minimums or assume that last year's staff are available.

The complete availability check must evaluate overlapping operational windows, active holds, confirmed obligations, pending returning-customer expectations, assigned crew, physical resources and travel/transfer time. Count the same physical resource only once if it appears on both a booking and its linked trip. Suggestions explain known conflicts and missing evidence; approval must not override a physical impossibility.

| Business rule | Required enforcement in the later release |
| --- | --- |
| Adventure Zone | Five normal complete sets; a sixth requires Dave's approval plus a verified equipment and staffing plan for the relevant dates. |
| Pirates | Three normal complete sets; a fourth requires Dave's approval and a verified extra pool/equipment and staffing plan. |
| Warrior's Playground | One physical setup. No simultaneous duplicate. Track paintball trailer transfers between legs. |
| Leg split | Approval by Dave or that leg's manager. Separate crew, package/resource allocation, transport and operating windows for both sites. |
| Strategic split | Prefer one full Adventure Zone event plus a smaller Pirates or Warrior event. Flag two full Adventure Zone events from one crew for explicit review; never treat a split as creating extra equipment. |
| Independent approvals | A split approval does not approve an extra Adventure Zone or Pirates set. Require the appropriate separate approval. |

Approval records identify the approving authorized person, decision, timestamp, relevant events, dates and exact crew/resource plan. Material changes to those facts invalidate the approval and require review. A historical approval or a note saying Dave approved something cannot become permanent extra capacity. Unresolved decisions show the responsible approver and next action.

Display public dates, travel, arrival, setup, operating, teardown and departure separately where verified. Preserve longer real reserved windows rather than silently replacing them with generic buffers. Unknown travel times or load-in addresses require review. Route estimates show provenance/age; provider calls must be explicit and bounded.

## Later release: Com parity and reviewed changes

Com should read the same bounded operations summary and readiness results that Desiree sees. Existing operational read tools remain useful for detailed evidence. Avoid sending the full customer history for each simple operation; deterministic checks belong in shared services, with no paid AI call needed to calculate a conflict or fetch a record.

Add reviewed write tools only after the equivalent app operation and shared validation exist. Require existing connector consent, exact revisions, stable request keys, transactional receipts and reread on conflict. Suggestions cannot silently become assignments, holds or approvals. Com cannot impersonate Dave or a manager to approve a split or extra package.

Prepare customer replies and documents for Desiree's review. Sending requires her explicit approval of the final correspondence. No automatic Gmail sends, signatures, calendar-wide writes, permission expansion, scheduled Com work or paid in-app AI execution is included here.

The first release may expose the new summary through an authorized read endpoint/tool. New operational write scopes and tools are deferred to this later release; existing consent must not be broadened automatically.

## Acceptance for the first release

1. Opening a returning customer's selected-season booking shows last season's verified leg/package and source, or a clear missing/unreconciled state.
2. Angel and Angelo remain distinct, archived history stays visible, and Jeremy/JR are never inferred to be the same person.
3. A suggestion and an existing assignment are visibly different. A route-based assignment with unknown crew/equipment is not presented as operationally ready.
4. Existing package/resource conflicts and pending requests appear in the same panel with useful resolution links.
5. Changing a leg through the existing editor is reflected after refresh on the booking, profile, schedule, map and route; no duplicate assignment record is introduced.
6. Selecting 2027 in the combined schedule/map cannot leave the embedded map silently on 2026. Navigation preserves explicit filters and lists unmapped/unassigned bookings.
7. Multiple packages for one event do not create duplicate historical event counts. Ambiguous matches remain visible for review.
8. Missing dates, unknown camper needs, no crew history, connection failures and stale estimates are explicit; none is interpreted as free capacity.
9. The panel remains usable on phone widths and in Dave's authorized view. Relevant manager views respect existing access boundaries.
10. Focused service/UI tests cover history ambiguity, state separation, shared season/navigation, assignment-refresh consistency and partial-read failures. Run the relevant builds and existing affected checks; no tests require live changes, outbound email or paid AI.

## Review and delivery boundary

The first implementation plan should cover only the connected view, its shared summary/read contract, consistent navigation, and existing-editor refresh behavior. Calendar repair, full staffing/inventory enforcement, structured split approvals and new Com mutations need their own scoped specs and acceptance checks.

Before planning, Desiree reviews this written spec. After written-spec approval, produce a concrete implementation plan and review its execution method. This document records intended behavior; it is not a claim that the features are already built.
