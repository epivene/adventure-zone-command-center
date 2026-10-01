# Com app capabilities: follow-up closure and remaining gaps

## Delivered change

Com could create/reschedule reminders but could not close obsolete ones. The app
already supports completion and dismissal through its follow-up edit service.
The connector now exposes `complete_followup` and `dismiss_followup` using that
same service and the existing `followups:write` scope. No new permissions are
granted automatically.

Both actions require profile ID, follow-up ID, exact `expectedRevision`, a reason,
and a stable `requestKey`. Read `list_followups` first. Completion records the
actual outcome; dismissal stores `Dismissed: <reason>`. The closed timestamp is
the app's existing mechanism for removing either kind from active reminders.
Dismissal does not claim a call, email or other contact happened. Listing and
receipts now include the outcome so clients can distinguish the two.

The transaction locks the profile and reminder, rejects stale revisions and
already-closed records, preserves the due date, kind and associations, and saves
a replayable receipt. It does not send messages, delete history, advance booking
status or automatically create a next reminder. A next action that needs an
actual reminder must be saved separately with its own verified date.

After merge/deployment, refresh connector tools. Com should read the two obsolete
Moorcroft October 21 reminders and the October 9 replacement, verify which IDs
are superseded, dismiss only those obsolete records with their exact revisions,
then re-read to verify. This implementation did not modify those live records.

## Capability audit

This is a source-level audit of the main operational workflows, not a claim of
exhaustive parity across every app endpoint. App actions remain subject to owner
authorization, existing scopes and the rule to send only when instructed.

| Workflow | Connector capability | Remaining gap / next step |
| --- | --- | --- |
| Follow-ups | List, create, reschedule; now complete and dismiss | Permanent deletion and full Opportunity completion with next-action/stage updates remain separate. Prefer dismissal for obsolete reminders. |
| Shared work | List/read, claim, progress/status updates, release/reclaim | Explicit reassignment to another actor remains owner UI only. |
| Profiles and notes | Search/context, sourced lead creation, append/edit notes; approved field updates and merges | Not every profile/contact/date editing control has a connector equivalent. Preserve proposal/approval flows. |
| Legs, routes and equipment | Read schedules, route plans, resources, allocations and holds | No equivalent connector writes for leg assignments, package/resource configuration or crew/camper information. This is the next priority for lodging decisions. |
| Documents | Read stored current-version text and attach validated documents to app drafts | Upload, link/unlink, archive and document review actions remain app-only. |
| Contracts and invoices | Read available profile/document context | Contract/invoice preparation, version management and payment-status operations do not have complete direct connector coverage. |
| Drafts and communications | Save app drafts; email operations may be available through separately connected Gmail | App draft lifecycle and Gmail/profile assignment parity remain incomplete. Customer sends still need explicit approval. |

Evidence: connector `tool-registry.ts`, `booking-work-tools.ts` and operational
read definitions; app `routes/follow-ups.ts`, `routes/bookings.ts`,
`routes/business-documents.ts`, contract/invoice routes and follow-up controls.

For future connector work, pair each owner-visible action with its service-level
equivalent, read-before-write revision checks, a receipt and a regression test.
Expose missing capability clearly; never substitute a fabricated success or
direct database bypass. This PR resolves follow-up closure only; the rows above
are the remaining work list.

## Verification

- Tests were written first: four closure tests and MCP discovery failed before
  implementation (five failing assertions); the focused run then passed all 15.
- The closure tests cover retained history/outcome, unchanged reminder details,
  receipt replay, changed-request rejection, cross-profile access, missing scope,
  revocation, blank reasons, stale revisions and already-closed reminders.
- The HTTP MCP integration additionally completes and dismisses reminders through
  real connector dispatch with app AI disabled and provider imports prohibited.
- API build passed. No schema or UI changes are required.
- Tests use PGlite rather than production PostgreSQL. Local runtime is Node 24;
  the project declares Node 22. No live reminder or customer communication was changed.

- Expanded verification: `node node_modules/vitest/vitest.mjs run --maxWorkers=2
  src/features/chatgpt-connection src/features/follow-ups src/routes/follow-ups.test.ts`
  finished with **134 passed, 1 skipped, 2 failed**. The failures reproduce on the
  unchanged baseline:
  - `follow-up-repository.pglite.test.ts`: “rolls back unlink, audit, and deletion
    when deleting the target fails” expects the inner forced-error wording but
    receives the repository's wrapped query error.
  - `single-active-follow-up.pglite.test.ts`: “replaces the previous open follow-up
    for the same booking and preserves it as history” has a fixture missing
    `organization_location_id`.
- The real HTTP connector integration passed both tests separately. The focused
  closure/draft/discovery run passed all 15. No package-wide typecheck is claimed;
  the immediately preceding queue work documented API typecheck memory limits.

- Full API command was attempted with two workers and a 60-second limit; it did not finish. Observed failures are listed below, without claiming a clean full suite or attributing every failure to baseline:

```text
❯ src/features/act-replacement/organize-schema-contract.test.ts (21 tests | 1 failed | 6 skipped) 28ms
× freezes job source versions and binds archive links to exact source provenance 10ms
❯ src/features/act-replacement/drizzle-apply-repository.test.ts (36 tests | 1 failed) 2124ms
× persists ACT phone create, update, and clear through exact lookup and destination constraints 2092ms
❯ src/features/outreach-planner/outreach-repository.pglite.test.ts (24 tests | 4 failed) 32597ms
× runs migration twice, saves edits, audits profile and preserves manual/promo steps 1952ms
× distinguishes outgoing silent calls, convention provenance and manually classified tier 1415ms
× recovers SQL source failure at google_workspace_validation_mappings savepoint while preserving known blockers and callbacks 1498ms
× recovers SQL source failure at booking_opportunity_email_state savepoint while preserving known blockers and callbacks 1297ms
❯ src/features/organizations/organization-merge.integration.test.ts (0 test)
```
