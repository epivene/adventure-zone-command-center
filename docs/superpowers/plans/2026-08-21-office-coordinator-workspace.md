# Office Coordinator Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Office Coordinator account and Booking Workspace that can see all profiles, safely maintain factual event/contact information, handle mail and office tasks, draft emails for owner review, and message the owner without gaining owner, sales-strategy, route-manager, finance, crew, import, or outbound-send permissions.

**Architecture:** Keep Office Coordinator authentication and authorization completely separate from the existing owner and travel-leg manager systems. Add focused office tables and allowlisted `/office/*` APIs before the owner middleware, owner-only `/office-admin/*` APIs after the owner middleware, a dedicated Office shell/frontend, and a small owner Office Coordinator admin area. Safe profile reads project only office-appropriate fields, safe edits use strict factual-field schemas, and all outbound email delivery remains owner-only behind a server-side delivery interface.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing HMAC session patterns, existing Activity/Audit repositories, Nodemailer SMTP for owner-authorized outbound email.

**Spec:** `docs/superpowers/specs/2026-08-21-office-coordinator-workspace-design.md`

## Global Constraints

- The user-facing role is **Office Coordinator**. The workspace may say **Booking Workspace**.
- Do not use user-facing language such as Support Portal, Limited Manager, Restricted Access, Supervised, Awaiting Desiree Approval, Checked by Admin, or Sales Priority.
- The first Office Coordinator account may be created for Amy after deployment, but no account name, username, or password is hardcoded or seeded in source.
- Office authentication is person/account based, never attached to a travel leg.
- Office API access is allowlist-based. An Office token never authorizes existing owner or leg-manager endpoints.
- Office profile reads must not expose private prioritization, Last Resort controls, probability/ranking, route assignment, finance, crew, import provenance, manager operations, or admin settings.
- Office profile writes are limited to factual profile/contact/location fields and new notes. Crafted extra fields must be rejected by strict schemas.
- Office users may create, edit, and submit email drafts but never call an email-delivery endpoint.
- Owner email delivery must claim one submitted draft before sending so retries/double-clicks cannot send the same draft twice.
- A failed owner email send leaves the draft retryable as Submitted; it must never be falsely marked Sent.
- Mail completion is atomic: do not mark the related task Done unless the structured mail log and history entry both succeed.
- Owner queue ordering is private metadata. Office responses preserve order but never expose `ownerSortOrder` or equivalent priority reasoning.
- Existing owner Command Center and leg-manager behavior must remain unchanged.
- Use normal work history/audit records; do not add productivity scoring or hidden performance metrics.
- Keep first release manual. Do not add automatic task generation yet.

---

### Task 1: Add Office Coordinator schema and durable tables

**Files:**
- Create: `lib/db/src/office-coordinator-schema.ts`
- Create: `lib/db/migrations/20260821_office_coordinator_workspace.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/package.json`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/features/office/office-schema-contract.test.ts`

**Data model:**

```ts
export const officeRoleValues = ["office_coordinator"] as const;
export const officeTaskTypeValues = [
  "contact_verification",
  "mail_brochure",
  "follow_up_prep",
  "research_update",
  "draft_email",
  "other",
] as const;
export const officeTaskStatusValues = [
  "todo",
  "in_progress",
  "waiting",
  "done",
  "cancelled",
] as const;
export const officeEmailStateValues = [
  "draft",
  "submitted",
  "needs_changes",
  "sending",
  "sent",
] as const;
```

Tables:

```text
office_accounts
  id uuid PK
  login_name text NOT NULL
  display_name text NOT NULL
  role text NOT NULL CHECK office_coordinator
  password_hash text NOT NULL
  password_salt text NOT NULL
  enabled boolean NOT NULL default true
  session_version integer NOT NULL default 1 CHECK >= 1
  created_at / updated_at timestamptz
  UNIQUE INDEX lower(login_name)

office_tasks
  id uuid PK
  office_account_id uuid NOT NULL -> office_accounts
  task_type text NOT NULL
  title text NOT NULL
  instructions text
  organization_id uuid -> organizations
  contact_id uuid -> contacts
  status text NOT NULL default todo
  needs_help boolean NOT NULL default false
  coordinator_note text
  owner_sort_order bigint NOT NULL
  due_at timestamptz
  created_by text NOT NULL CHECK owner|system
  created_at / updated_at / completed_at

office_mail_activity
  id uuid PK
  office_account_id uuid NOT NULL -> office_accounts
  task_id uuid -> office_tasks
  organization_id uuid NOT NULL -> organizations
  contact_id uuid -> contacts
  recipient_name text
  address_1_snapshot text
  address_2_snapshot text
  city_snapshot text
  region_snapshot text
  postal_code_snapshot text
  prepared_at timestamptz
  mailed_at timestamptz
  note text
  created_at / updated_at

office_email_drafts
  id uuid PK
  office_account_id uuid NOT NULL -> office_accounts
  organization_id uuid NOT NULL -> organizations
  contact_id uuid NOT NULL -> contacts
  recipient_email text NOT NULL
  subject text NOT NULL
  body text NOT NULL
  coordinator_note text
  state text NOT NULL
  submitted_at timestamptz
  owner_return_note text
  sent_at timestamptz
  sent_message_id text
  last_send_error text
  created_at / updated_at

office_messages
  id uuid PK
  office_account_id uuid NOT NULL -> office_accounts
  actor_kind text NOT NULL CHECK office|owner
  body text NOT NULL
  read_by_office_at timestamptz
  read_by_owner_at timestamptz
  created_at timestamptz
```

Also add a real nullable `description` column to `organizations` in the migration and Drizzle schema. The existing profile-description route can remain backward-compatible, but Office reads should no longer depend on runtime DDL to discover the column.

- [ ] **Step 1: Write the schema contract test first**

Test exported Drizzle tables/constants and migration text for required checks/indexes. Include assertions that `office_tasks.office_account_id` exists and that `organizations.description` is present.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/office/office-schema-contract.test.ts
```

Expected: FAIL because the office schema module/tables do not exist.

- [ ] **Step 3: Add the SQL migration and matching Drizzle schema**

Use foreign keys with sensible deletion behavior: account deletion is not supported in v1; task/mail/draft/message rows should retain their actor relationship, so account management uses `enabled=false` rather than deleting accounts. Use indexes for `(office_account_id, status, owner_sort_order)`, Needs Help, draft state/submission date, mail profile/date, and messages account/date.

- [ ] **Step 4: Export the schema everywhere the API expects it**

Update `@workspace/db` exports and `artifacts/api-server/src/db/schema.ts` so office feature modules can import the typed tables without direct SQL-only access.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/office/office-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/office-coordinator-schema.ts lib/db/migrations/20260821_office_coordinator_workspace.sql lib/db/src/index.ts lib/db/package.json lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/office/office-schema-contract.test.ts
git commit -m "feat: add office coordinator data model"
```

---

### Task 2: Extract reusable password credentials and add Office token primitives

**Files:**
- Create: `artifacts/api-server/src/lib/password-credential.ts`
- Create: `artifacts/api-server/src/lib/password-credential.test.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-auth.ts`
- Create: `artifacts/api-server/src/features/office/office-auth.ts`
- Create: `artifacts/api-server/src/features/office/office-auth.test.ts`

**Interfaces:**

```ts
export async function hashPasswordCredential(password: string): Promise<{
  hash: string;
  salt: string;
}>;
export async function verifyPasswordCredential(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean>;

export type OfficeTokenClaims = {
  accountId: string;
  sessionVersion: number;
  expiresAtMs: number;
};

export function issueOfficeToken(input: {
  accountId: string;
  sessionVersion: number;
}): { token: string; expiresAt: string } | null;
export function verifyOfficeToken(token: string): OfficeTokenClaims | null;
```

Office tokens use a distinct `office.` prefix and the same `SESSION_SECRET` infrastructure. Keep the current 30-day session lifetime unless a later security policy changes it.

- [ ] **Step 1: Write failing credential/token tests**

Prove password hashes verify, wrong passwords fail, Office tokens round-trip, expired/tampered tokens fail, and Office tokens do not parse as leg-manager tokens.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/lib/password-credential.test.ts \
  artifacts/api-server/src/features/office/office-auth.test.ts
```

- [ ] **Step 3: Extract scrypt without changing manager behavior**

Keep `hashLegManagerPassword` and `verifyLegManagerPassword` as compatibility exports that delegate to the shared credential module. Do not change the existing `leg.` token format.

- [ ] **Step 4: Implement isolated Office token format**

Use payload shape `office.<accountId>.<sessionVersion>.<expiresAtMs>.<signature>` and timing-safe signature comparison.

- [ ] **Step 5: Run manager auth regression tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/lib/password-credential.test.ts \
  artifacts/api-server/src/features/office/office-auth.test.ts \
  artifacts/api-server/src/routes/leg-manager-auth.test.ts
git add artifacts/api-server/src/lib/password-credential* artifacts/api-server/src/features/office/office-auth* artifacts/api-server/src/features/leg-manager/leg-manager-auth.ts
git commit -m "feat: add isolated office authentication primitives"
```

---

### Task 3: Add Office account repository, middleware, login, and owner account administration

**Files:**
- Create: `artifacts/api-server/src/features/office/office-account-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-middleware.ts`
- Create: `artifacts/api-server/src/routes/office-auth.ts`
- Create: `artifacts/api-server/src/routes/office-auth.test.ts`
- Create: `artifacts/api-server/src/routes/office-admin-accounts.ts`
- Create: `artifacts/api-server/src/routes/office-admin-accounts.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Public/Office routes:**

```text
POST /office/auth/login      { loginName, password }
GET  /office/auth/me         Office bearer token required
```

**Owner-only routes:**

```text
GET   /office-admin/accounts
POST  /office-admin/accounts
PATCH /office-admin/accounts/:accountId
PUT   /office-admin/accounts/:accountId/password
POST  /office-admin/accounts/:accountId/sign-out-all
```

`POST /office-admin/accounts` accepts `{ loginName, displayName, password }`, assigns role `office_coordinator`, hashes the password server-side, and never returns credential material.

- [ ] **Step 1: Write route tests before implementation**

Cover successful login, incorrect credentials, disabled account, stale session version, duplicate case-insensitive login name, password reset increments session version, disabling an account revokes existing sessions, and sign-out-all increments session version.

- [ ] **Step 2: Add security-crossing tests**

With an Office token, requests to representative owner/manager endpoints such as `/today`, `/manager/money/summary`, and `/manager-admin/crew` must remain unauthorized. With an owner token, `/office-admin/accounts` works. Never make Office middleware a fallback auth mechanism for owner routes.

- [ ] **Step 3: Implement repository + middleware**

Extend Express request typing with a dedicated `officeAccount` property containing `{ accountId, displayName, role }`. Resolve every request against the database so disabled accounts and session-version changes take effect immediately.

- [ ] **Step 4: Mount routes in the correct order**

In `routes/index.ts`:

```ts
router.use(officeAuthRouter); // login route plus its own /me middleware
router.use(officeRouter);     // later tasks; internally requires Office auth
// existing public manager routers...
router.use(requireOwnerMiddleware);
router.use(officeAdminAccountsRouter);
// existing owner routers...
```

Do not place `/office-admin/*` before owner middleware.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/routes/office-auth.test.ts \
  artifacts/api-server/src/routes/office-admin-accounts.test.ts \
  artifacts/api-server/src/routes/leg-manager-auth.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/office/office-account-repository.ts artifacts/api-server/src/features/office/office-middleware.ts artifacts/api-server/src/routes/office-auth* artifacts/api-server/src/routes/office-admin-accounts* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add office coordinator account access"
```

---

### Task 4: Build Office tasks and private owner ordering

**Files:**
- Create: `artifacts/api-server/src/features/office/office-task-types.ts`
- Create: `artifacts/api-server/src/features/office/office-task-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-task-repository.test.ts`
- Create: `artifacts/api-server/src/routes/office-tasks.ts`
- Create: `artifacts/api-server/src/routes/office-tasks.test.ts`
- Create: `artifacts/api-server/src/routes/office-admin-tasks.ts`
- Create: `artifacts/api-server/src/routes/office-admin-tasks.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Office DTO:**

```ts
export type OfficeTaskView = {
  id: string;
  type: OfficeTaskType;
  title: string;
  instructions: string | null;
  profile: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  status: "todo" | "in_progress" | "waiting" | "done";
  needsHelp: boolean;
  coordinatorNote: string | null;
  dueAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};
```

Never include `officeAccountId`, `ownerSortOrder`, or owner priority reasoning in Office task responses.

**Office routes:**

```text
GET   /office/tasks?view=active|done
PATCH /office/tasks/:taskId { status?, coordinatorNote?, needsHelp? }
GET   /office/today
```

**Owner routes:**

```text
GET   /office-admin/tasks?accountId=...
POST  /office-admin/tasks
PATCH /office-admin/tasks/:taskId
POST  /office-admin/tasks/reorder { accountId, taskIds }
```

- [ ] **Step 1: Write repository tests**

Test account-scoped lists, stable owner ordering, Done completion timestamp, reopening clears completion timestamp, cancel hiding from Office, and cross-account task mutation rejection.

- [ ] **Step 2: Write API tests for strict mutation boundaries**

A crafted Office PATCH containing `ownerSortOrder`, `officeAccountId`, `organizationId`, or `taskType` must return 400 rather than silently expanding authority.

- [ ] **Step 3: Implement owner reorder transaction**

Require the supplied task IDs to exactly belong to the selected account and active queue subset being reordered. Assign deterministic spaced values such as `1000, 2000, 3000...` in one transaction.

- [ ] **Step 4: Implement `/office/today` task projection**

Return the first ordered active tasks plus counts. Later tasks extend this payload with returned email drafts and unread messages without changing the private-ordering rule.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-task-repository.test.ts \
  artifacts/api-server/src/routes/office-tasks.test.ts \
  artifacts/api-server/src/routes/office-admin-tasks.test.ts
git add artifacts/api-server/src/features/office/office-task-* artifacts/api-server/src/routes/office-tasks* artifacts/api-server/src/routes/office-admin-tasks* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add office coordinator task queue"
```

---

### Task 5: Add safe all-profile search and Office profile projections

**Files:**
- Create: `artifacts/api-server/src/features/office/office-profile-service.ts`
- Create: `artifacts/api-server/src/features/office/office-profile-service.test.ts`
- Create: `artifacts/api-server/src/routes/office-profiles.ts`
- Create: `artifacts/api-server/src/routes/office-profiles.test.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Office profile list routes:**

```text
GET /office/profiles?q=&page=
GET /office/profiles/:profileId
```

Use `DrizzleOrganizationRepository.listOrganizations` with fixed safe filters, `includeRetired:false`, and a simple query/page input. Project only fields needed by the Office UI.

**Safe profile detail projection:**

```ts
export type OfficeProfileView = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  contacts: Array<{
    id: string;
    name: string;
    role: string | null;
    isPrimary: boolean;
    phone: string | null;
    email: string | null;
    locationName: string | null;
  }>;
  bookings: Array<{
    id: string;
    name: string;
    primaryContactId: string | null;
    city: string;
    region: string;
    startsAt: string | null;
    endsAt: string | null;
    status: string;
  }>;
  notes: Array<{ id: string; kind: string; body: string; occurredAt: string }>;
  locations: OfficeLocationView[];
  mailActivity: OfficeMailActivityView[];
};
```

Deliberately omit booking `probability`, booking strategic notes, Last Resort values, groups/calling lists, source provenance/ACT IDs, route/travel-leg details, manager reviews, assistant flags, and owner-only relationship controls.

- [ ] **Step 1: Write projection tests that prove both visibility and omission**

Assert Office can retrieve every normal live profile, including profiles without bookings. Assert the JSON does not contain `probability`, `lastResort`, `lastResortReason`, `travelLeg`, `sourceProvenance`, `actRecordId`, `managerReviews`, or import/admin metadata.

- [ ] **Step 2: Add description to the event-profile repository projection**

Read `organizations.description` as factual content for both normal and Office profile displays. Keep existing owner behavior compatible.

- [ ] **Step 3: Implement list/detail service**

The service owns the safe projection so route code never returns a raw `EventProfile` object directly.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-profile-service.test.ts \
  artifacts/api-server/src/routes/office-profiles.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/office/office-profile-service* artifacts/api-server/src/routes/office-profiles* artifacts/api-server/src/features/event-profiles/event-profile-repository.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose safe office profile views"
```

---

### Task 6: Add strict factual profile, contact, location, and note edits

**Files:**
- Create: `artifacts/api-server/src/features/office/office-profile-input.ts`
- Create: `artifacts/api-server/src/features/office/office-profile-editor.ts`
- Create: `artifacts/api-server/src/features/office/office-profile-editor.test.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.test.ts`

**Office mutations:**

```text
PATCH /office/profiles/:profileId
PUT   /office/profiles/:profileId/contacts/:contactId
PATCH /office/profiles/:profileId/locations/:locationId
POST  /office/profiles/:profileId/notes
```

**Allowed profile fields:**

```ts
{
  name,
  description,
  phone,
  address1,
  address2,
  city,
  region,
  postalCode,
  website,
}
```

**Allowed contact fields:**

```ts
{
  firstName,
  lastName,
  jobTitle,
  relationshipRole,
  email,
  address1,
  address2,
  city,
  region,
  postalCode,
  phones: [{ id, number, type, extension, label, primary }],
}
```

**Allowed location fields:** `label`, `venueName`, `address1`, `address2`, `city`, `region`, `postalCode`, `website`, `phone`, `email` only.

- [ ] **Step 1: Write malicious-payload tests first**

Attempt to submit `lastResort`, `probability`, `travelLegId`, `localStatus`, `lat`, `lng`, sync/source fields, organization reassignment, DNC state, or unrelated contact IDs. Expect 400/403, never a silent write.

- [ ] **Step 2: Implement active-profile/contact relationship validation**

Before contact edits, prove the contact is actively associated with the profile. Use the existing phone repository inside the same transaction and preserve its DNC/suppression safeguards.

- [ ] **Step 3: Implement safe location update**

Use `DrizzleLocationRepository.update` only after strict parsing removes every non-factual field. Verify location belongs to the profile.

- [ ] **Step 4: Implement notes through ActivityService**

Create a normal `kind:"note"` activity linked to the organization. Add a second audit entry identifying the Office actor, e.g. action `office_note_created`, without changing imported ACT history.

- [ ] **Step 5: Record actor-aware audit entries for factual edits**

Use actions `office_profile_updated`, `office_contact_updated`, and `office_location_updated`. Store before/after factual snapshots plus `officeAccountId` and `officeDisplayName` in audit JSON.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-profile-editor.test.ts \
  artifacts/api-server/src/routes/office-profiles.test.ts
git add artifacts/api-server/src/features/office/office-profile-input.ts artifacts/api-server/src/features/office/office-profile-editor* artifacts/api-server/src/routes/office-profiles*
git commit -m "feat: allow safe office profile maintenance"
```

---

### Task 7: Build structured brochure/mail logging with atomic completion

**Files:**
- Create: `artifacts/api-server/src/features/office/office-mail-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-mail-service.ts`
- Create: `artifacts/api-server/src/features/office/office-mail-service.test.ts`
- Create: `artifacts/api-server/src/routes/office-mail.ts`
- Create: `artifacts/api-server/src/routes/office-mail.test.ts`
- Create: `artifacts/api-server/src/routes/office-admin-mail.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Office routes:**

```text
GET  /office/mail
POST /office/mail/:taskId/prepared
POST /office/mail/:taskId/mailed
```

Prepared input snapshots recipient/address after the Office Coordinator verifies/corrects the profile. Mailed input accepts `mailedAt` and a bounded optional note containing postage/tracking context.

- [ ] **Step 1: Write service tests first**

Cover only `mail_brochure` tasks, correct Office account ownership, prepared update, mailed update, retry/idempotency behavior, and rejection of a mail action for another account's task.

- [ ] **Step 2: Prove atomic failure behavior**

Inject a failing Activity/Audit write and assert the mail row/task status is rolled back. The task becomes Done only after the mail row and profile-history note both succeed.

- [ ] **Step 3: Create human-readable profile history**

Use normal timeline notes such as `Brochure prepared for <recipient>` and `Brochure mailed to <recipient> on <date>` while keeping full structured snapshots in `office_mail_activity`.

- [ ] **Step 4: Add owner history endpoint**

```text
GET /office-admin/mail?accountId=...
```

Return operational records by account/profile/date with no hidden score or completion-rate rollup.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-mail-service.test.ts \
  artifacts/api-server/src/routes/office-mail.test.ts
git add artifacts/api-server/src/features/office/office-mail-* artifacts/api-server/src/routes/office-mail* artifacts/api-server/src/routes/office-admin-mail.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: track office brochure mail work"
```

---

### Task 8: Add email draft lifecycle without send permission

**Files:**
- Create: `artifacts/api-server/src/features/office/office-email-types.ts`
- Create: `artifacts/api-server/src/features/office/office-email-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-email-service.ts`
- Create: `artifacts/api-server/src/features/office/office-email-service.test.ts`
- Create: `artifacts/api-server/src/routes/office-email-drafts.ts`
- Create: `artifacts/api-server/src/routes/office-email-drafts.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Office routes:**

```text
GET   /office/email-drafts
POST  /office/email-drafts
PATCH /office/email-drafts/:draftId
POST  /office/email-drafts/:draftId/submit
```

Creation accepts profile/contact IDs plus subject/body/note; the server verifies the contact belongs to the profile and snapshots the contact's current nonblank email address rather than accepting arbitrary recipients.

- [ ] **Step 1: Write lifecycle tests**

Prove create/edit in Draft, submit -> Submitted, owner-returned Needs Changes can be edited/resubmitted, Submitted cannot be edited by Office, Sent is immutable, and one account cannot read/mutate another account's draft.

- [ ] **Step 2: Add explicit no-send security test**

Search the Office router surface and assert there is no `/office/.../send` route. Also send an Office token to the later owner send route path and expect owner-auth rejection.

- [ ] **Step 3: Implement submission snapshots/audit**

On Submit, update `recipient_email`, subject, body, submitted timestamp, clear stale owner return note, and record `office_email_submitted` with Office actor identity.

- [ ] **Step 4: Extend `/office/today`**

Include drafts in `needs_changes` state near the top of the Office Today payload, so returned drafts are obvious work items.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-email-service.test.ts \
  artifacts/api-server/src/routes/office-email-drafts.test.ts
git add artifacts/api-server/src/features/office/office-email-* artifacts/api-server/src/routes/office-email-drafts* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add office email draft submission"
```

---

### Task 9: Add owner-only outbound email delivery, edit-and-send, and return-for-changes

**Files:**
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `render.yaml`
- Create: `artifacts/api-server/src/features/office/mail-delivery.ts`
- Create: `artifacts/api-server/src/features/office/mail-delivery.test.ts`
- Create: `artifacts/api-server/src/routes/office-admin-email-drafts.ts`
- Create: `artifacts/api-server/src/routes/office-admin-email-drafts.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Dependencies:**
- Runtime: `nodemailer`
- Dev types: `@types/nodemailer`

**Server-only Render variables:**

```text
OFFICE_MAIL_SMTP_HOST
OFFICE_MAIL_SMTP_PORT
OFFICE_MAIL_SMTP_SECURE
OFFICE_MAIL_SMTP_USER
OFFICE_MAIL_SMTP_PASSWORD
OFFICE_MAIL_FROM
```

Do not add any `VITE_*` mail credentials.

**Delivery interface:**

```ts
export type MailDeliveryInput = {
  to: string;
  subject: string;
  body: string;
};

export interface MailDelivery {
  send(input: MailDeliveryInput): Promise<{ messageId: string }>;
}
```

**Owner routes:**

```text
GET  /office-admin/email-drafts?state=submitted
POST /office-admin/email-drafts/:draftId/return { note }
POST /office-admin/email-drafts/:draftId/send {
  recipientEmail?,
  subject?,
  body?
}
```

Optional send fields implement **Edit & Send**. If omitted, send exactly the submitted snapshot.

- [ ] **Step 1: Write mail-delivery tests with a fake transport**

Verify env validation, from/to/subject/text mapping, and a clear configuration error when SMTP is absent.

- [ ] **Step 2: Write draft send concurrency tests**

Repository/service must atomically transition one row `submitted -> sending`. A second simultaneous send attempt receives 409/locked behavior instead of delivering twice.

- [ ] **Step 3: Implement safe send state transitions**

On success: persist final recipient/subject/body snapshot, `state=sent`, `sentAt`, `sentMessageId`, clear error. On delivery failure: restore `state=submitted`, persist bounded `lastSendError`, and return 502/503. Never mark Sent before the transport succeeds.

- [ ] **Step 4: Implement Return for Changes**

Require a nonblank bounded owner note; transition Submitted -> Needs Changes. Record owner return/send audit actions.

- [ ] **Step 5: Add SMTP configuration to Render manifest**

All entries are `sync:false` except no value should be committed. Deployment remains healthy without SMTP; only the Send action returns a clear 503 until configured.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm install
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/mail-delivery.test.ts \
  artifacts/api-server/src/routes/office-admin-email-drafts.test.ts \
  artifacts/api-server/src/routes/office-email-drafts.test.ts
git add artifacts/api-server/package.json pnpm-lock.yaml render.yaml artifacts/api-server/src/features/office/mail-delivery* artifacts/api-server/src/routes/office-admin-email-drafts* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add owner-reviewed email delivery"
```

---

### Task 10: Add simple Office-owner messages independent of leg-manager communications

**Files:**
- Create: `artifacts/api-server/src/features/office/office-message-repository.ts`
- Create: `artifacts/api-server/src/features/office/office-message-repository.test.ts`
- Create: `artifacts/api-server/src/routes/office-messages.ts`
- Create: `artifacts/api-server/src/routes/office-messages.test.ts`
- Create: `artifacts/api-server/src/routes/office-admin-messages.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

Do not extend `manager_conversations` in this release; it is leg-oriented and would blur the permission boundary.

**Office routes:**

```text
GET  /office/messages
POST /office/messages { body }
POST /office/messages/read
```

**Owner routes:**

```text
GET  /office-admin/messages/:accountId
POST /office-admin/messages/:accountId { body }
POST /office-admin/messages/:accountId/read
```

- [ ] **Step 1: Write account-isolation/unread tests**

Office can only read its own thread. Owner can open any Office account thread. Sending an Office message increments owner unread; owner reply increments Office unread; read endpoints clear only the viewer's unread state.

- [ ] **Step 2: Implement bounded text-only messages**

First release supports plain text only, max 8,000 characters. No attachments, manager broadcasts, route references, or leg membership.

- [ ] **Step 3: Extend `/office/today` with unread count**

Return `unreadMessages` so the shell can badge Messages without exposing other accounts.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/office/office-message-repository.test.ts \
  artifacts/api-server/src/routes/office-messages.test.ts
git add artifacts/api-server/src/features/office/office-message-* artifacts/api-server/src/routes/office-messages* artifacts/api-server/src/routes/office-admin-messages.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: add office coordinator messages"
```

---

### Task 11: Add Office frontend authentication, routing, shell, and navigation

**Files:**
- Create: `artifacts/adventure-zone/src/lib/office-auth-context.tsx`
- Create: `artifacts/adventure-zone/src/lib/office-route-pattern.ts`
- Create: `artifacts/adventure-zone/src/components/office/office-shell.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-mobile-nav.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeSignInPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeSignInPage.test.tsx`
- Create: `artifacts/adventure-zone/src/App.office-routing.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Frontend session:**
- Local storage key: `az_office_token`
- Identity: `{ id, displayName, role:"office_coordinator" }`
- Login fields: Username + Password
- Bootstrap: `/office/auth/me`
- API helper sends only the Office bearer token for Office calls.

**Routes:**

```text
/office/sign-in
/office
/office/profiles
/office/profiles/:id
/office/mail
/office/emails
/office/tasks
/office/messages
```

Register Office routes before the generic owner `<Protected>` fallback in `App.tsx`.

- [ ] **Step 1: Write auth separation test**

Signing in stores `az_office_token` and leaves `az_owner_token` / `az_manager_token` unchanged. 401 clears only the Office token.

- [ ] **Step 2: Write App routing test**

Prove `/office/sign-in` does not require owner auth; `/office/*` redirects to Office sign-in without Office session; an Office session renders OfficeShell; Office paths never render AppShell or ManagerShell.

- [ ] **Step 3: Build dedicated shell**

Header copy:

```text
Adventure Zone
Office Coordinator
```

Desktop/mobile nav includes Today, Profiles, Mail, Email Drafts, Tasks, Messages. Reuse `MessageBubbleLink` for the unread badge. Do not include owner Assistant, manager receipt/offline queues, finance, route, crew, or admin menus.

- [ ] **Step 4: Add global profile search**

A compact search field in OfficeShell navigates to `/office/profiles?q=<value>`; do not expose owner advanced filters.

- [ ] **Step 5: Add a landing-page entry**

Add a neutral **Office Coordinator** link to `/office/sign-in` alongside the existing Admin and Manager entries.

- [ ] **Step 6: Run frontend tests and commit**

```bash
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts \
  src/pages/OfficeSignInPage.test.tsx \
  src/App.office-routing.test.tsx \
  src/App.manager-routing.test.tsx
git add artifacts/adventure-zone/src/lib/office-* artifacts/adventure-zone/src/components/office artifacts/adventure-zone/src/pages/OfficeSignInPage* artifacts/adventure-zone/src/App.office-routing.test.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add office coordinator app shell"
```

---

### Task 12: Build Office Today, Tasks, Profiles, and safe profile editing UI

**Files:**
- Create: `artifacts/adventure-zone/src/pages/OfficeTodayPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeTasksPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeProfilesPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-task-card.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-profile-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-contact-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-location-editor.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

- [ ] **Step 1: Write UI tests from the approved wording**

Assert Today shows **Next up**, statuses **To do / In progress / Waiting / Done**, and **Needs Help**. Assert forbidden wording such as Support Portal, Restricted Access, Sales Priority, or Awaiting Approval is absent.

- [ ] **Step 2: Build Today around ordered work**

Show returned-email changes first, then ordered active tasks. Task cards can Start, Wait, Done, toggle Needs Help, edit note, and open linked profile. Do not show why the owner ordered tasks that way.

- [ ] **Step 3: Build simple all-profile search/list**

Show profile name, city/state, primary contact, and enough factual context to choose the right record. No Last Resort/leg/probability filters.

- [ ] **Step 4: Build Office profile detail**

Sections: About/description, factual contact info, locations/venues, relevant bookings, notes/history, mail history. Actions: Edit Profile, Edit Contact, Edit Location, Add Note, Draft Email.

- [ ] **Step 5: Use Office-specific editors**

Do not reuse `profile-inline-editor.tsx` unchanged because it calls owner APIs. Editors submit only strict Office schemas.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts src/pages/OfficeWorkspace.test.tsx
pnpm run typecheck
git add artifacts/adventure-zone/src/pages/OfficeTodayPage.tsx artifacts/adventure-zone/src/pages/OfficeTasksPage.tsx artifacts/adventure-zone/src/pages/OfficeProfilesPage.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx artifacts/adventure-zone/src/components/office artifacts/adventure-zone/src/App.tsx
git commit -m "feat: build office coordinator daily workspace"
```

---

### Task 13: Build Office Mail, Email Drafts, and Messages UI

**Files:**
- Create: `artifacts/adventure-zone/src/pages/OfficeMailPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeMessagesPage.tsx`
- Create: `artifacts/adventure-zone/src/components/office/office-email-editor.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

- [ ] **Step 1: Write mail workflow UI test**

From a mail-brochure task, verify recipient/address, click Prepared, enter mailed date/note, mark Mailed, and see the task become Done only after success.

- [ ] **Step 2: Write email UI lifecycle test**

Draft editor shows Save Draft and **Submit Email**, never Send. Submitted becomes read-only. Needs Changes displays owner note and can be edited/resubmitted. Sent displays Sent.

- [ ] **Step 3: Add Draft Email entry from profiles**

Recipient options come only from contacts returned by the Office profile API. The server still revalidates/snapshots the contact email.

- [ ] **Step 4: Build Messages**

Simple chronological Office-owner thread, compose box, unread badge/read-on-open. Keep language neutral and work-focused.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts src/pages/OfficeCommunications.test.tsx
git add artifacts/adventure-zone/src/pages/OfficeMailPage.tsx artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx artifacts/adventure-zone/src/pages/OfficeMessagesPage.tsx artifacts/adventure-zone/src/components/office/office-email-editor.tsx artifacts/adventure-zone/src/pages/OfficeCommunications.test.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add office mail drafts and messages ui"
```

---

### Task 14: Build owner Office Coordinator admin area

**Files:**
- Create: `artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/office-admin/office-account-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/office-admin/office-task-manager.tsx`
- Create: `artifacts/adventure-zone/src/components/office-admin/office-email-review.tsx`
- Create: `artifacts/adventure-zone/src/components/office-admin/office-mail-history.tsx`
- Create: `artifacts/adventure-zone/src/components/office-admin/office-message-thread.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`

Route: `/office-coordinator`

Suggested tabs:
- Work Queue
- Email Review
- Mail & History
- Messages
- Account

- [ ] **Step 1: Write owner page tests**

Test create/reset/disable account, task create/edit/reorder/cancel, Needs Help visibility, email Send/Edit & Send/Return for Changes, mail history, and messages.

- [ ] **Step 2: Build task manager with drag/buttons that persist private order**

The owner UI may call the field Priority/Order privately if useful, but Office responses/UI never receive the metadata or rationale.

- [ ] **Step 3: Build email review controls**

Show profile, recipient, subject, body, coordinator note, submission date. Buttons: Send, Edit & Send, Return for Changes. Require explicit click; no auto-send.

- [ ] **Step 4: Build account controls**

Owner creates the actual Office Coordinator login after deployment. Never display current password; only Reset Password, Enable/Disable, Sign Out All.

- [ ] **Step 5: Add owner navigation**

Add **Office Coordinator** under the existing Bookings & Follow-ups menu group, not Legs & Operations.

- [ ] **Step 6: Run tests and commit**

```bash
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts src/pages/OfficeCoordinatorAdminPage.test.tsx
git add artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage* artifacts/adventure-zone/src/components/office-admin artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx
git commit -m "feat: add owner office coordinator controls"
```

---

### Task 15: Surface Office attention items on owner Today

**Files:**
- Create: `artifacts/api-server/src/features/office/office-owner-attention.ts`
- Create: `artifacts/api-server/src/features/office/office-owner-attention.test.ts`
- Modify: `artifacts/api-server/src/routes/today.ts`
- Create: `artifacts/adventure-zone/src/components/today/office-coordinator-attention.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`

**Response extension:**

```ts
officeCoordinatorAttention: {
  needsHelpCount: number;
  submittedDraftCount: number;
  needsHelpTasks: Array<{
    id: string;
    title: string;
    profileId: string | null;
    profileName: string | null;
    updatedAt: string;
  }>;
  submittedDrafts: Array<{
    id: string;
    profileId: string;
    profileName: string;
    recipientEmail: string;
    subject: string;
    submittedAt: string;
  }>;
}
```

Return at most five preview rows in each list plus total counts.

- [ ] **Step 1: Write API attention tests**

Only active Needs Help tasks and Submitted drafts count. Cancelled/Done task help flags and Needs Changes/Sent drafts do not appear as owner review attention.

- [ ] **Step 2: Keep Office failures isolated from Today**

If Office attention loading fails, log/warn and return empty attention data rather than breaking the existing owner Today dashboard.

- [ ] **Step 3: Write Today UI tests**

Show a compact **Office Coordinator** card only when attention exists, with links to `/office-coordinator?tab=tasks` and `/office-coordinator?tab=emails`. Existing renewals/follow-up behavior remains unchanged.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/office/office-owner-attention.test.ts
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts src/pages/TodayPage.test.tsx
git add artifacts/api-server/src/features/office/office-owner-attention* artifacts/api-server/src/routes/today.ts artifacts/adventure-zone/src/components/today/office-coordinator-attention.tsx artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.test.tsx
git commit -m "feat: surface office coordinator reviews on today"
```

---

### Task 16: Security regression, end-to-end workflow tests, and deployment readiness

**Files:**
- Create: `artifacts/api-server/src/routes/office-security-regression.test.ts`
- Create: `artifacts/adventure-zone/src/office-workspace-flow.test.tsx`
- Modify only files found by failures from this task; do not broaden scope.

- [ ] **Step 1: Add explicit authorization matrix tests**

For a valid Office token, assert rejection of representative endpoints in every forbidden category:

```text
Owner /today
Owner /bookings
Owner /routes
Owner /settings
Owner /manager-admin/*
Leg manager /manager/route
Leg manager /manager/money/summary
Leg manager /manager/crew
Owner outbound /office-admin/email-drafts/:id/send
```

Also prove owner and manager tokens do not become Office sessions by token-prefix confusion.

- [ ] **Step 2: Add safe-field payload regression tests**

Attempt crafted factual-edit requests with every known forbidden strategic/operational field. Assert no mutation occurs.

- [ ] **Step 3: Add complete happy-path integration test**

Cover:

```text
Owner creates Office account
→ Office signs in
→ Owner creates/reorders task
→ Office sees Next up queue
→ Office opens any profile and corrects factual data
→ Office logs brochure mailed; task completes
→ Office creates + submits email draft
→ Owner Today shows submitted draft
→ Owner returns draft for changes
→ Office edits + resubmits
→ Owner sends via fake mail delivery
→ Office sees Sent
→ Office/owner exchange a message
```

- [ ] **Step 4: Run the complete verification suite**

```bash
pnpm --filter @workspace/api-server test
pnpm --dir artifacts/adventure-zone exec vitest run --config vitest.config.ts
pnpm run typecheck
pnpm run build
```

Expected: all pass.

- [ ] **Step 5: Verify migration/deploy configuration**

Confirm `pnpm --filter @workspace/db run-migrations` discovers `20260821_office_coordinator_workspace.sql`. Confirm Render contains only server-side SMTP variable declarations and no secrets/credentials in source.

- [ ] **Step 6: Perform source-level forbidden-language check**

Search Office user-facing frontend files for: `Support Portal`, `Limited Manager`, `Restricted Access`, `Supervised`, `Awaiting Desiree`, `Checked by Admin`, and `Sales Priority`. Tests/source should not contain those strings except an explicit negative test fixture.

- [ ] **Step 7: Commit final verification fixes**

```bash
git status --short
git add -- <only files changed by verification fixes>
git commit -m "test: verify office coordinator workspace"
```

If no verification fixes were needed, do not create an empty commit.

## Final Acceptance Checklist

- [ ] Office Coordinator has a named username/password login independent of travel legs.
- [ ] Office Coordinator can search and open all live profiles.
- [ ] Office profile data includes factual event/contact/location/history context but excludes private sales/route/admin metadata.
- [ ] Factual profile/contact/location edits and notes work and are auditable.
- [ ] Owner controls task creation and queue order; Office sees only natural Next up order.
- [ ] Mail/brochure workflow records recipient/address snapshots, prepared date, mailed date, and history atomically.
- [ ] Office can Draft and Submit Email but has no Send capability in UI or API.
- [ ] Owner can Send, Edit & Send, or Return for Changes.
- [ ] Failed email delivery remains Submitted/retryable; successful delivery alone becomes Sent.
- [ ] Office and owner can message each other without entering leg-manager communications.
- [ ] Owner has an Office Coordinator admin page and Office review items surface on owner Today.
- [ ] Existing owner and leg-manager login, navigation, and permissions still pass regression tests.
- [ ] No account/password is hardcoded for Amy; owner creates the account after deployment.
- [ ] No user-facing supervisory/restricted wording appears in the Office workspace.
