# Task4C — explicit future-prospect event identity resolution

Implemented from dedicated base `a0202ae` on `codex/outreach-identity-resolution`. No migration, provider operation, customer send, live data access, rollout change, remote write, or other-worktree modification was performed.

## Owner/API contract

`POST /api/outreach-planner/opportunities/:id/bind-booking` is owner-only through the existing router and feature-gated before database access. Strict input:

```json
{
  "bookingId": "<existing booking UUID>",
  "confirmedEventYear": 2026,
  "confirmedSameEvent": true,
  "reason": "Organizer confirmed this is the same annual event",
  "sourceReference": "Event website, correspondence, or source record reference"
}
```

The ID must be a UUID; year is an integer from 2000–2200; reason and source reference must be nonblank trimmed strings of at most 2,000 characters. Success returns `{opportunityId, organizationId, bookingId, eventYear, reused, reason, sourceReference}`. A first binding has `reused:false`; repeating the same current valid binding has `reused:true` without rewriting the opportunity, invalidating new reviews, or adding duplicate binding audit/activity. Malformed requests return 400, missing opportunities and disabled rollout return 404, and identity/protection/dispatch conflicts return actionable 409.

The existing `GET /profiles?q=<profile name>&year=<event year>` supplies named booking choices. New controls appear for unlinked candidates in Today and the profile outreach summary. They show current opportunity/profile/year and selected booking name plus actual start/end dates before the explicit confirmation checkbox. Reason and evidence are required. Local mutation errors retain all inputs and selections; success reloads shared planner state. Unknown capacity remains review, and the existing demand/fit/hold controls remain the next step.

Ordinary admission still conservatively refuses a different booking identity, including null-to-booking. Binding is a separate action; undated opportunity admission and candidate addition remain possible.

## Identity, concurrency, and preservation

The service uses `withAllocationTransaction`, taking the allocation mutex, then the shared planner advisory lock, before profile/opportunity/booking row locks. It rereads the opportunity after locking the profile and verifies the exact current organization/year/link. This shares dispatch claim/final-check and allocation serialization. A missing mutex fails closed.

Binding rejects a consolidated/missing or protected profile, opportunity email protection, an unapproved territory hold, and organization/contact/recipient-email communication blocks. Both the existing opportunity contact and selected booking primary contact are checked; the opportunity contact is preserved. Booking organization must match, both actual dates must be finite and ordered, and both dates must fall in the selected `America/Chicago` event year. A different already-linked booking is never repointed.

An unresolved `dispatching` or `uncertain` delivery blocks identity changes using both durable payload identity and current Opportunity/Office draft associations. Unknown-year Office delivery on the profile is conservatively included. Same-binding no-ops do not change identity under a dispatch.

Only `booking_opportunities.booking_id` and its update timestamp change. Opportunity status, priority, callback/next action, candidate membership/rank/decision/history review, drafts and actual calls/follow-ups/source history, and saved research results survive. Derived allocation checks are invalidated through the existing helper, including generation and cached snapshots. Binding creates no demand, allocation, hold, organization, booking, or replacement opportunity.

The audit records actor, explicit confirmation, reason/source, prior/new identity, booking name/dates, retired approvals, and a linked profile activity ID. Profile activity states the previous unlinked identity, selected event/dates, actor, reason/source, and remaining capacity/content review in human-readable prose.

## Draft review after binding

Opportunity draft digests already include the current opportunity booking identity. Unassigned Office drafts retain their own null booking until the separate existing Office identity assignment action; they now additionally bind their digest to sorted current matching linked opportunity identities. For an unknown-year Office draft this context includes the profile's linked event-year opportunities. The optional `DraftReview.opportunityIdentities` field is present only when this additional context exists. Thus an already-open Office review cannot reapprove its old digest after binding, including if it was opened before the mutation.

Affected saved approvals are retired atomically and retained in the identity audit. Existing approval/content-revision, live-hold identity/revision, capacity fingerprint and freshness checks continue to apply. This does not assign Office draft identity or authorize any specific offer. Existing previously approved unassigned Office mail with known linked opportunity context will require fresh review under the expanded digest.

## Reconciliation of supplied attempts

The two unattributed implementation/UI patches and separately supplied existing-test patch were inspected, not blindly applied. The original lifecycle intent—same opportunity, preserved manual callback/draft history, idempotent repeat, and refusal to switch an existing link—is retained in the stronger PGlite lifecycle regression. The implementation additionally enforces explicit same-event/source evidence, profile/opportunity protection, shared allocation locking, and unresolved delivery. It does not clear historical review or require binding during candidate admission as the weaker patches proposed. No unexpected concurrent source changes appeared in the dedicated worktree.

## Changed files

- `artifacts/api-server/src/features/outreach-planner/outreach-dto.ts`
- `artifacts/api-server/src/features/outreach-planner/outreach-service.ts`
- `artifacts/api-server/src/features/outreach-planner/outreach-workspace.ts`
- `artifacts/api-server/src/features/outreach-planner/outreach-dispatch.ts`
- `artifacts/api-server/src/features/outreach-planner/outreach-allocation.pglite.test.ts`
- `artifacts/api-server/src/routes/outreach-planner.ts`
- `artifacts/api-server/src/routes/outreach-planner.test.ts`
- `artifacts/adventure-zone/src/features/outreach-planner/outreach-api.ts`
- `artifacts/adventure-zone/src/components/today/outreach-planner.tsx`
- `artifacts/adventure-zone/src/components/today/outreach-planner.test.tsx`
- This report.

## Verification

All database verification uses local PGlite with injected Calendar/travel evidence. The original repository admission test remains unchanged and is included in the focused gate. New lifecycle cases cover late booking selection/binding, exact preserved manual/history/research state, normal exact-demand and verified-fit checks without implicit holds, wrong profile/year/date/protection, repeat safety, unresolved delivery for both draft kinds, missing mutex, and stale Office review for known and unknown years. Route cases cover feature-off/owner authentication and mandatory explicit evidence. UI cases cover owner selection/confirmation, wrong-profile option exclusion, preserved failure inputs/retry, shared refresh, and visible remaining capacity review.

The inherited API runtime initially resolved another checkout's `@workspace/db` exports. Verification used a temporary `vitest.task4c.config.ts` retaining the API alias/environment and mapping each `@workspace/db` export to this worktree's package source. No shared runtime package or tracked test configuration was changed. Temporary compiler configs were also local and removed after verification.

Final commands and results are appended below. Early test-only setup errors (a nonexistent allocation method and a misplaced test-local preview variable) were corrected before the final gates.

## Self-review and limitations

Self-review checked the brief against the complete diff and found/fixed the Office stale-preview race described above. The provided history test behavior remains covered in the allocation PGlite fixture, which supplies the real dispatch/allocation schema needed for this boundary. No persistence limitation requires a migration.

Owners must first save a real booking with actual dates and independently establish equipment demand/availability. Source references are owner evidence, not automated verification of external sources. The UI requires an existing candidate/profile outreach entry; admission to an opening remains the existing path to that entry. No live-browser screenshot or broad production build was needed for these focused changes; the directly affected interaction suite and scoped compilers are the verification gates. No known unresolved implementation or test failure remains after the final gates.

### Final gate results

From `artifacts/api-server`:

```sh
./node_modules/.bin/vitest run --config vitest.task4c.config.ts --maxWorkers=1 \
  src/features/outreach-planner/outreach-allocation.pglite.test.ts \
  src/features/outreach-planner/outreach-repository.pglite.test.ts \
  src/routes/outreach-planner.test.ts \
  -t 'explicit prospect event identity resolution|outreach owner routes|admits a scouted profile|edits then restores content|definite rejection allows retry'
```

Exit 0: **3 files, 13 passed, 62 intentionally skipped**, 21.10s.

From `artifacts/adventure-zone`:

```sh
./node_modules/.bin/vitest run --config vitest.config.ts \
  src/components/today/outreach-planner.test.tsx --reporter=dot
```

Exit 0: **1 file, 24 passed**, 3.76s.

From each application directory:

```sh
node /workspace/scratch/6a92df6125f9/command-center/node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/lib/tsc.js \
  -p tsconfig.task4c.json --noEmit --pretty false
```

Both exit 0, **no diagnostics**. The API config extends the worktree base config, disables incremental output, uses Node types and the production Zod v4 alias, maps local workspace package exports to this worktree, and includes the changed DTO/service/workspace/PGlite test/routes plus application type declarations (dispatch and allocation are included through imports). The frontend config extends its application config with only the planner/API runtime files as roots, no broad includes or project references, and incremental output disabled. These are scoped compiler results, not a claim of a clean whole-application compiler.

`git diff --check`: exit 0. Temporary compiler/Vitest configs were removed. The root-owned 184-test gate and broad builds were not repeated.
