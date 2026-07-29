# CRM Residual Fixes Implementation Plan

**Goal:** Clear the two load-bearing residuals from the CRM final scoped re-review without changing the completed CRM architecture.

**Tech stack:** Next.js 16, TypeScript, Drizzle/PostgreSQL, Vitest, Playwright.

## Global constraints

- Preserve the enforced rule that nonterminal contact/organization-only calls require a future next action.
- Preserve all owner gates, canonical call-context validation, transaction/idempotency behavior, and local-only integrations.
- Today priority must be global across the full open-follow-up result set, not merely within a page.
- Apply priority in SQL before `LIMIT`/`OFFSET`; do not return to an unbounded application-memory sort.
- Keep the Playwright scenario strong and realistic; do not weaken the required next-action policy.
- The authenticated E2E and real-PostgreSQL release gates remain fail-closed.

## Task 1: Fix Quick Add E2E completion and global Today priority

**Files:**

- Modify: `tests/e2e/call-workspace.spec.ts`
- Modify: `features/follow-ups/today-query.ts`
- Modify: `tests/unit/today-priority.test.ts`
- Modify or create: Today SQL/query contract test(s)

### Step 1: Add failing regressions

- Update the Quick Add browser scenario so `no_answer` supplies a valid future
  next action and due date, then asserts the call saves and the replacement
  follow-up exists.
- Add a Today regression with more records than one page where a later raw due
  date has a higher priority bucket than earlier lower-priority work. Assert the
  high-priority record appears on page 1.
- Add SQL/query-contract assertions proving priority expressions precede
  pagination.

### Step 2: Implement priority-before-pagination

- Encode the documented `sortFollowUpsForToday` priority buckets and tie-breakers
  into the Drizzle/PostgreSQL `ORDER BY` used by `listOpenFollowUps`.
- Ensure `findNextCall` uses the same priority semantics for call records.
- Retain deterministic stable tie-breakers and current bounded page sizes.
- Remove redundant in-memory priority sorting if SQL now returns canonical order.

### Step 3: Verify

Run focused Today and Call Workspace tests, the complete unit/integration suite,
lint, typecheck, build, Playwright discovery, and the exact E2E command. The
exact browser run may stop only at the documented Clerk/auth environment gate.

### Step 4: Commit

```bash
git add features/follow-ups/today-query.ts tests/unit tests/e2e/call-workspace.spec.ts
git commit -m "fix: preserve Today priority across pages"
```
