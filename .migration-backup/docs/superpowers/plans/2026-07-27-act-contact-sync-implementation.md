# Act! Contact Sync and Contacts Workspace Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Add an editable Contacts workspace, safe manual two-way Act! contact synchronization, and whole-file duplicate detection for XLS/CSV imports.

**Architecture:** Command Center remains the local working database. A server-only Act! adapter authenticates against Act! Premium Cloud and maps remote contacts into canonical snapshots. Manual sync runs perform a three-way comparison against the last approved snapshot, store a preview, and apply explicitly approved rows idempotently. Contact pages read and edit PostgreSQL only; local edits are marked waiting until a later approved sync.

**Tech stack:** Next.js App Router and server actions, React 19, TypeScript, Drizzle ORM/PostgreSQL, Clerk owner authorization, Zod, Vitest/Testing Library, Playwright, Act! Web API/OData, Render environment secrets.

---

## Task 1: Reject collisions inside one XLS/CSV upload

**Files:**

- Modify: `tests/integration/act-import.test.ts`
- Modify: `features/import/act-matcher.ts`
- Modify: `features/import/act-types.ts`

### Step 1: Write failing collision tests

Add tests proving:

```ts
it("marks every row with a repeated email as conflict when record IDs are absent")
it("marks repeated Act record IDs as conflict")
it("allows a shared email when distinct Act record IDs identify the rows")
it("reports the conflicting CSV row numbers")
```

Construct all records in one `previewActImport` call and assert the categories before any local contacts exist.

### Step 2: Run the focused test and confirm failure

Run:

```bash
npx vitest run tests/integration/act-import.test.ts
```

Expected: new collision tests fail because every row is currently classified independently against only the repository.

### Step 3: Implement the smallest whole-file collision pass

In `act-matcher.ts`:

- Build normalized groups before repository matching.
- Group by record ID first.
- For rows without record IDs, group by normalized email.
- For rows without record ID/email, group by normalized company plus contact.
- Return conflict rows containing the source row numbers.
- Leave validation errors as errors.
- Leave distinct stable record IDs eligible for normal matching even when emails are shared.

Add a match reason such as `file_collision` only if the UI needs a typed reason; otherwise keep `none` and use explicit messages.

### Step 4: Run focused and importer UI tests

Run:

```bash
npx vitest run tests/integration/act-import.test.ts tests/unit/act-import-review.test.tsx
```

Expected: PASS.

### Step 5: Commit

```bash
git add features/import tests/integration/act-import.test.ts tests/unit/act-import-review.test.tsx
git commit -m "fix: detect collisions within Act imports"
```

## Task 2: Add contact fields and synchronization tables

**Files:**

- Modify: `db/schema.ts`
- Create: `db/migrations/0003_act_contact_sync.sql`
- Modify: `db/migrations/meta/_journal.json`
- Create or modify: `db/migrations/meta/0003_snapshot.json`
- Modify: `tests/unit/schema-contract.test.ts`

### Step 1: Write failing schema-contract tests

Assert that contacts expose:

```ts
[
  "jobTitle",
  "address1",
  "address2",
  "city",
  "region",
  "postalCode",
]
```

Assert the new sync schema exports tables for:

- Per-contact sync state and base snapshot
- Sync preview/apply runs
- Per-row operation results

### Step 2: Run the schema contract

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts
```

Expected: FAIL because the fields/tables do not exist.

### Step 3: Add the Drizzle schema

Add:

- Contact address/title columns.
- `act_contact_sync_states`, keyed by local contact ID, containing base snapshot JSON, last Act! edited timestamp, last synchronized timestamp, local-dirty flag, and constrained state.
- `act_sync_runs`, containing preview/apply status and summary JSON.
- `act_sync_operations`, containing stable operation keys, selected direction, snapshots, status, and sanitized result/error.
- Unique constraints for Act! identity and operation idempotency.
- Foreign keys with non-destructive delete behavior.

### Step 4: Generate and inspect the migration

Run:

```bash
npx drizzle-kit generate
```

Verify the generated migration only adds the intended fields, tables, checks, indexes, and foreign keys. Rename it to `0003_act_contact_sync.sql` if necessary and keep the metadata journal consistent.

### Step 5: Run schema tests and migration preflight

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts
npm run db:preflight
```

Expected: PASS.

### Step 6: Commit

```bash
git add db tests/unit/schema-contract.test.ts
git commit -m "feat: add Act contact sync schema"
```

## Task 3: Build the contact domain and local repository

**Files:**

- Create: `features/contacts/contact-types.ts`
- Create: `features/contacts/contact-input.ts`
- Create: `features/contacts/contact-repository.ts`
- Create: `tests/unit/contact-input.test.ts`
- Create: `tests/integration/contact-repository.test.ts`

### Step 1: Write failing input and repository tests

Cover:

- Empty/whitespace contact names are rejected.
- Email is normalized or null.
- Contact list search matches name, company, email, phone, and location.
- Pagination returns total count and current records.
- Detail returns related bookings.
- Local create and edit set `localDirty=true` and state `waiting`.
- Edit writes a contact audit entry.
- A missing contact returns `null`.

Use a repository interface and an in-memory test implementation for service-level behavior where direct Drizzle execution is not needed. Add focused Drizzle query-contract tests for mapping and updates.

### Step 2: Run focused tests and confirm failure

Run:

```bash
npx vitest run tests/unit/contact-input.test.ts tests/integration/contact-repository.test.ts
```

Expected: FAIL because the contact domain does not exist.

### Step 3: Implement contact types, validation, and repository

Implement:

- Canonical contact fields.
- `ContactSyncState` and list/detail view models.
- Zod schemas for create/edit.
- Search normalization.
- Server-side pagination with a default page size of 50.
- Detail query with organization, sync state, and related bookings.
- Transactional local create/edit, sync-state update, and audit record.
- Organization reuse by normalized name instead of creating a duplicate company on every edit.

### Step 4: Run focused tests

Run:

```bash
npx vitest run tests/unit/contact-input.test.ts tests/integration/contact-repository.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add features/contacts tests/unit/contact-input.test.ts tests/integration/contact-repository.test.ts
git commit -m "feat: add local contact domain"
```

## Task 4: Add the Contacts screens and navigation

**Files:**

- Create: `app/(private)/contacts/page.tsx`
- Create: `app/(private)/contacts/new/page.tsx`
- Create: `app/(private)/contacts/[contactId]/page.tsx`
- Create: `app/(private)/contacts/[contactId]/edit/page.tsx`
- Create: `app/(private)/contacts/actions.ts`
- Create: `components/contacts/contact-list.tsx`
- Create: `components/contacts/contact-form.tsx`
- Create: `components/contacts/sync-state-badge.tsx`
- Modify: `components/navigation/app-shell.tsx`
- Create: `tests/unit/contact-components.test.tsx`
- Modify: `tests/e2e/responsive.spec.ts`

### Step 1: Write failing component/navigation tests

Test:

- Search form preserves query/filter values.
- Waiting/conflict/synced/unlinked badges have readable labels.
- Contact form submits all supported fields and renders server errors.
- List links to detail pages.
- Detail displays related bookings.
- Main and mobile navigation include Contacts.

### Step 2: Run focused tests

Run:

```bash
npx vitest run tests/unit/contact-components.test.tsx
```

Expected: FAIL because components/routes are missing.

### Step 3: Implement owner-protected pages and actions

- Require `requireOwner()` before all reads and writes.
- Use URL search parameters for query, state, and page.
- Revalidate contact and booking paths after local edits.
- Show **Waiting to sync** immediately after save.
- Do not add delete controls.
- Keep the layout responsive and consistent with current booking pages.
- Adjust mobile navigation sizing so the additional item remains usable.

### Step 4: Run focused tests, lint, and typecheck

Run:

```bash
npx vitest run tests/unit/contact-components.test.tsx
npm run lint
npm run typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add app/'(private)'/contacts components/contacts components/navigation tests
git commit -m "feat: add editable Contacts workspace"
```

## Task 5: Add server-only Act! configuration and API client

**Files:**

- Modify: `lib/env.ts`
- Create: `features/act-sync/act-types.ts`
- Create: `features/act-sync/act-client.ts`
- Create: `features/act-sync/act-errors.ts`
- Create: `tests/unit/act-env.test.ts`
- Create: `tests/integration/act-client.test.ts`

### Step 1: Write failing configuration/client tests

Cover:

- Configuration accepts only `https://apius.act.com/act.web.api`.
- Missing credentials produce a safe “not configured” state for page rendering.
- Authorization sends Basic credentials and `Act-Database-Name` server-side.
- The password/token never appears in thrown or returned errors.
- Bearer tokens are used for contact requests.
- Contacts are fetched through every OData page.
- Contact create/update payloads use expected Act! field names.
- HTTP timeout, 401, 4032, 429, malformed JSON, and oversized responses map to sanitized typed errors.

Use injected `fetch` and fake responses. Never make real Act! calls in automated tests.

### Step 2: Run focused tests and confirm failure

Run:

```bash
npx vitest run tests/unit/act-env.test.ts tests/integration/act-client.test.ts
```

Expected: FAIL because the client does not exist.

### Step 3: Implement the minimal Act! adapter

- Keep credentials in server-only environment parsing.
- Use a fixed-host URL guard.
- Exchange Basic credentials for a bearer token.
- Add abort/timeout handling.
- Implement connection test, paginated contact retrieval, get-one, create, and update.
- Select only required fields and expand business address.
- Read and expose rate-limit metadata without logging headers.
- Normalize Act! responses into typed remote contacts.

### Step 4: Run focused tests and security checks

Run:

```bash
npx vitest run tests/unit/act-env.test.ts tests/integration/act-client.test.ts tests/unit/service-worker-security.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add lib/env.ts features/act-sync tests/unit/act-env.test.ts tests/integration/act-client.test.ts
git commit -m "feat: add secure Act API client"
```

## Task 6: Implement canonical snapshots and three-way comparison

**Files:**

- Create: `features/act-sync/contact-snapshot.ts`
- Create: `features/act-sync/sync-comparison.ts`
- Create: `tests/unit/act-sync-comparison.test.ts`

### Step 1: Write the comparison matrix as failing tests

Test every category:

```ts
"new_in_act"
"new_in_app"
"changed_in_act"
"changed_in_app"
"changed_in_both"
"possible_match"
"already_matched"
"missing_from_act"
"error"
```

Also test:

- Stable Act! ID wins over email.
- Distinct stable IDs may share email.
- Unique normalized email can establish a first link.
- Duplicate email candidates become possible matches.
- Unique normalized company/name is the final fallback.
- Comparison ignores harmless whitespace/case differences.
- Base snapshot distinguishes one-sided from two-sided edits.

### Step 2: Run the focused test and confirm failure

Run:

```bash
npx vitest run tests/unit/act-sync-comparison.test.ts
```

Expected: FAIL.

### Step 3: Implement pure comparison functions

Keep matching and comparison free of database/network calls. Return deterministic row IDs, category, local/remote/base snapshots, messages, and allowed decisions.

### Step 4: Run focused tests

Run:

```bash
npx vitest run tests/unit/act-sync-comparison.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add features/act-sync tests/unit/act-sync-comparison.test.ts
git commit -m "feat: compare local and Act contacts"
```

## Task 7: Store and retrieve sync previews

**Files:**

- Create: `features/act-sync/sync-repository.ts`
- Create: `features/act-sync/sync-service.ts`
- Create: `tests/integration/act-sync-preview.test.ts`

### Step 1: Write failing preview-service tests

Verify:

- Preview fetches Act! only when explicitly called.
- Every accessible remote contact is compared.
- Preview stores source snapshots and summary counts.
- Reopening a preview does not call Act! again.
- A preview cannot be applied by another owner context.
- Unconfigured/permission/rate-limit errors are sanitized.
- Preview creation changes no contact data.

### Step 2: Run the focused test and confirm failure

Run:

```bash
npx vitest run tests/integration/act-sync-preview.test.ts
```

Expected: FAIL.

### Step 3: Implement repository and preview service

- Introduce interfaces for Act client and sync repository.
- Load local contacts plus mappings/base snapshots.
- Create comparison rows with pure functions.
- Persist preview run and operations.
- Return safe view models.

### Step 4: Run focused tests

Run:

```bash
npx vitest run tests/integration/act-sync-preview.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add features/act-sync tests/integration/act-sync-preview.test.ts
git commit -m "feat: create Act sync previews"
```

## Task 8: Implement safe, idempotent sync apply

**Files:**

- Modify: `features/act-sync/sync-service.ts`
- Modify: `features/act-sync/sync-repository.ts`
- Create: `tests/integration/act-sync-apply.test.ts`

### Step 1: Write failing apply tests

Cover:

- Pull new Act! contact into Command Center and save its record ID.
- Push new local contact and save returned Act! record ID.
- Apply one-sided updates in both directions.
- Require a decision for changed-in-both and possible-match rows.
- Link without changing fields.
- Keep separate contacts.
- Re-fetch and compare Act! `edited` before a remote write.
- Convert a stale preview into a conflict.
- Record an audit entry for every successful local or remote effect.
- Preserve successful operations after a later row fails.
- Retry only unfinished operations.
- Repeating an apply request does not duplicate remote contacts.
- No delete occurs for missing remote records.

### Step 2: Run focused tests and confirm failure

Run:

```bash
npx vitest run tests/integration/act-sync-apply.test.ts
```

Expected: FAIL.

### Step 3: Implement per-row apply

- Validate selected decisions against allowed decisions from preview.
- Use stable idempotency keys stored in `act_sync_operations`.
- Re-fetch remote records before writes.
- Apply remote effect, then record local mapping/base snapshot/audit state.
- Mark row success or sanitized failure.
- Never resend completed operations.
- Complete the run only when no approved operation remains pending.

### Step 4: Run preview/apply tests

Run:

```bash
npx vitest run tests/integration/act-sync-preview.test.ts tests/integration/act-sync-apply.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add features/act-sync tests/integration/act-sync-apply.test.ts
git commit -m "feat: apply Act sync decisions safely"
```

## Task 9: Add the Act! sync review interface

**Files:**

- Create: `app/(private)/settings/act-sync/page.tsx`
- Create: `app/(private)/settings/act-sync/actions.ts`
- Create: `components/act-sync/act-sync-review.tsx`
- Create: `components/act-sync/sync-row.tsx`
- Modify: `components/navigation/app-shell.tsx`
- Modify: `app/(private)/settings/import/page.tsx`
- Create: `tests/unit/act-sync-review.test.tsx`
- Create: `tests/unit/act-sync-routes.test.ts`

### Step 1: Write failing UI and route tests

Test:

- Connection state is masked.
- **Test connection** and **Sync with Act!** are separate actions.
- Sync button creates preview only.
- Safe rows can be bulk-approved.
- Conflict/possible-match rows require an explicit decision.
- Apply sends only approved rows and decisions.
- Partial failures remain visible and retryable.
- Settings navigation includes Act! Sync and Import fallback.
- All actions require owner authorization.

### Step 2: Run focused tests and confirm failure

Run:

```bash
npx vitest run tests/unit/act-sync-review.test.tsx tests/unit/act-sync-routes.test.ts
```

Expected: FAIL.

### Step 3: Implement the review experience

- Add connection card and sanitized status.
- Add preview summary tabs.
- Show local and Act! field differences side by side.
- Add safe bulk approval.
- Add per-row decision controls for conflicts.
- Require a separate apply click.
- Revalidate Contacts and sync pages after success.
- Update import copy so it is clearly labeled as a fallback.

### Step 4: Run focused tests, lint, and typecheck

Run:

```bash
npx vitest run tests/unit/act-sync-review.test.tsx tests/unit/act-sync-routes.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add app/'(private)'/settings components/act-sync components/navigation tests/unit
git commit -m "feat: add manual Act sync review"
```

## Task 10: Document configuration and operational recovery

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/operations/act-sync.md`
- Modify: `docs/operations/act-import.md`
- Modify: `docs/operations/deployment.md`
- Modify: `render.yaml`
- Create: `tests/integration/act-sync-docs.test.ts`

### Step 1: Write failing documentation/configuration contract tests

Assert:

- All required Act! environment variable names are documented.
- No actual username/password/database secret values are committed.
- Render declares secret variables with `sync: false` or equivalent safe configuration.
- Runbook explains connection test, preview, apply, partial retry, password rotation, and XLS fallback.

### Step 2: Run the focused test and confirm failure

Run:

```bash
npx vitest run tests/integration/act-sync-docs.test.ts
```

Expected: FAIL.

### Step 3: Add safe configuration documentation

Document:

- `ACT_API_BASE_URL`
- `ACT_DATABASE_NAME`
- `ACT_USERNAME`
- `ACT_PASSWORD`
- How to add values directly in Render.
- How to test without revealing secrets.
- What 401, 4032, and 429 mean.
- How to retry an interrupted apply.
- How to rotate the shared password.

Never include the real shared username or password.

### Step 4: Run focused tests

Run:

```bash
npx vitest run tests/integration/act-sync-docs.test.ts
```

Expected: PASS.

### Step 5: Commit

```bash
git add .env.example README.md render.yaml docs tests/integration/act-sync-docs.test.ts
git commit -m "docs: add Act sync operations guide"
```

## Task 11: Full regression and browser verification

**Files:**

- Modify as needed: `tests/e2e/responsive.spec.ts`
- Create: `tests/e2e/contacts.spec.ts`
- Create: `tests/e2e/act-sync.spec.ts`

### Step 1: Add end-to-end coverage

Cover:

- Contacts desktop/mobile navigation.
- Search, filter, pagination, detail, create, and edit.
- Waiting-to-sync badge after a local edit.
- Sync preview produces no changes.
- Conflict requires a choice.
- Apply uses mocked Act! responses and updates UI.
- Import collision rows remain unselectable.

### Step 2: Run the complete verification suite

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e
git diff --check
```

Expected: all commands PASS.

### Step 3: Review security-sensitive diffs

Run:

```bash
git diff HEAD~10 -- lib/env.ts features/act-sync app/'(private)'/settings/act-sync render.yaml .env.example
git grep -n -E 'ACT_PASSWORD=.+|Authorization: Basic [A-Za-z0-9+/=]+|Bearer eyJ'
```

Expected: no committed credential/token values and no client-side secret exposure.

### Step 4: Commit final test adjustments

```bash
git add tests
git commit -m "test: verify contacts and Act sync flows"
```

## Task 12: Publish, migrate, configure, and perform a controlled production sync

**Files:**

- No new source files unless deployment verification exposes a defect.

### Step 1: Push the reviewed branch

Use the repository publishing workflow to push commits to GitHub without force-pushing or overwriting unrelated work.

### Step 2: Configure Render secrets

Add the four Act! variables directly in Render. Do not paste the password into chat, a shell command recorded in history, GitHub, or source files.

### Step 3: Deploy and verify migration

Confirm:

- Render build succeeds.
- Migration `0003_act_contact_sync.sql` succeeds.
- Health check stays OK.
- Existing bookings and contacts still load.

### Step 4: Test connection only

Use **Test Act! connection** and verify a sanitized success response. Inspect logs to ensure no credentials or bearer tokens were written.

### Step 5: Preview a production sync

Press **Sync with Act!** and inspect category counts. Do not apply until:

- Existing test-import contacts are classified sensibly.
- Ambiguous shared emails are conflicts/possible matches.
- No unexpected deletes are proposed.

### Step 6: Apply a very small reviewed sample

Approve one safe Act!-to-app row and one safe app-to-Act! row. Verify both systems, audit records, mapping IDs, and waiting-state clearance before applying a larger batch.

### Step 7: Final handoff

Report:

- Production URL and deployed commit
- Migration status
- Test/verification results
- Connection status
- First-sync preview counts
- Any rows intentionally left for manual review

