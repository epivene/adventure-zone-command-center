# Boss Review and Input Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dave's Boss home page a durable action queue for rapid convention-note entry and exact-revision email-template approval, with Owner review before CRM application.

**Architecture:** Add a typed Boss work-request aggregate with immutable transition history, specialized convention submissions, and template-review snapshots. Expose role-specific Express routes before and after the existing owner middleware boundary, then add focused Boss and Owner React screens. Reuse the current communication-template lifecycle and CRM tables; make saves and applies transactional and idempotent.

**Tech Stack:** TypeScript, Express 5, PostgreSQL, Drizzle ORM, Zod, React 19, Wouter, TanStack React Query, Vitest, Testing Library, PGlite.

**Spec:** `docs/superpowers/specs/2026-09-09-boss-review-input-workspace-design.md`

## Global Constraints

- `Needs Your Attention` is the first page Dave sees after Boss sign-in.
- Release 1 supports only `rapid_convention_notes` and `email_template_approval`.
- Amy receives no new workflow, access, routes, or navigation; historical attribution remains intact.
- Dave cannot edit canonical email-template wording or apply convention data to CRM records.
- Convention data never changes CRM records until the Owner explicitly approves it.
- A visible convention form resets only after the server confirms persistence.
- Autosave uses monotonically increasing client revisions; an older acknowledgement never marks newer edits saved.
- Save and apply mutations are idempotent.
- Approval belongs to one immutable template fingerprint; any later content edit requires a fresh approval.
- Existing Boss schedule, contacts, profiles, receipts, reviews, maintenance, assignments, and documents remain accessible.
- Role-specific Boss routes stay before `router.use(requireOwnerMiddleware)` in `artifacts/api-server/src/routes/index.ts`.
- Bulk-campaign sending remains outside this feature and continues to require its own immutable audience/copy snapshot and explicit delivery approval.
- Template previews use a sandboxed iframe for HTML; never inject template HTML into the application document.
- No email, SMS, or push notifications are added in Release 1.

---

## File map

### Database

- Create `lib/db/src/boss-work-request-schema.ts` — Drizzle tables, state/type unions, indexes, checks, and relations for work requests, immutable events, convention entries/drafts, and template reviews.
- Create `lib/db/migrations/20260909b_boss_work_requests.sql` — repeat-safe forward migration matching the aggregate schema.
- Modify `lib/db/src/index.ts`, `lib/db/src/drizzle-schema.ts`, `lib/db/src/schema/index.ts`, and `artifacts/api-server/src/db/schema.ts` — export the new schema.
- Modify `lib/db/src/business-source-schema.ts` — add `bodyFormat` to communication templates.
- Modify `lib/db/src/migrations.ts` — register the new migration.

### Server feature

- Create `artifacts/api-server/src/features/boss-work-requests/boss-work-request-types.ts` — public request/response types and Zod inputs.
- Create `artifacts/api-server/src/features/boss-work-requests/boss-work-request-state.ts` — allowed state transitions and urgency sorting.
- Create `artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts` — account-scoped persistence and transactions.
- Create `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts` — role-neutral orchestration, idempotent save, exact-revision decisions, and dashboard summaries.
- Create `artifacts/api-server/src/features/boss-work-requests/convention-apply-service.ts` — match preview and one-transaction CRM application.
- Create focused tests beside those files.

### Server routes

- Create `artifacts/api-server/src/routes/boss-work-requests.ts` — Boss-only listing, autosave, submit/edit, approve, and request-changes endpoints.
- Create `artifacts/api-server/src/routes/boss-work-requests-owner.ts` — Owner-only creation, review, clarification, cancellation, preview, application, and revision-resubmission endpoints.
- Modify `artifacts/api-server/src/routes/index.ts` — mount the Boss router before the owner gate and the Owner router after it.
- Modify `artifacts/api-server/src/routes/boss-dashboard.ts` — include only the lightweight work summary.
- Modify `artifacts/api-server/src/routes/communication-templates.ts` — send company templates for Dave review and remove direct activation for approval-required revisions.
- Add route tests under `artifacts/api-server/src/routes/`.

### Boss client

- Create `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-types.ts` — browser-facing discriminated unions.
- Create `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-api.ts` — typed wrappers around `bossGet`, `bossPost`, and `bossPatch`.
- Create `artifacts/adventure-zone/src/features/boss-work-requests/use-convention-draft.ts` — revision-safe local/server autosave.
- Create `artifacts/adventure-zone/src/components/boss-work-requests/BossAttentionQueue.tsx` — queue and recently completed list.
- Create `artifacts/adventure-zone/src/components/boss-work-requests/RapidConventionNotesForm.tsx` — repeat-entry form and Saved Today list.
- Create `artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx` — sandboxed recipient preview and decisions.
- Create `artifacts/adventure-zone/src/pages/BossWorkRequestPage.tsx` — request detail route.
- Modify `artifacts/adventure-zone/src/pages/BossHomePage.tsx`, `artifacts/adventure-zone/src/App.tsx`, and `artifacts/adventure-zone/src/components/boss/boss-shell.tsx`.

### Owner client

- Create `artifacts/adventure-zone/src/features/boss-work-requests/owner-boss-work-request-api.ts`.
- Create `artifacts/adventure-zone/src/pages/DaveRequestsPage.tsx`.
- Create `artifacts/adventure-zone/src/components/boss-work-requests/OwnerConventionReview.tsx`.
- Modify `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`, `artifacts/adventure-zone/src/pages/TodayPage.tsx`, `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`, and `artifacts/adventure-zone/src/App.tsx`.

### Template rendering and conversion

- Modify `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`.
- Modify `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`.
- Modify `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`.
- Create `artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.ts`.
- Modify `artifacts/api-server/src/features/google-workspace/google-api-client.ts` and `artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts` for explicit plain-text/HTML MIME creation.
- Modify `artifacts/adventure-zone/src/components/office/office-email-editor.tsx` so a rendered template preserves its body format through draft creation.

---

### Task 1: Persist Boss work requests and formatted templates

**Files:**
- Create: `lib/db/src/boss-work-request-schema.ts`
- Create: `lib/db/migrations/20260909b_boss_work_requests.sql`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-schema.test.ts`
- Modify: `lib/db/src/business-source-schema.ts`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/drizzle-schema.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `lib/db/src/migrations.ts`

**Interfaces:**
- Produces: `bossWorkRequests`, `bossWorkRequestEvents`, `bossConventionDrafts`, `bossConventionSubmissions`, `communicationTemplateReviews`.
- Produces: `BossWorkRequestType`, `BossWorkRequestState`, `BossWorkRequestPriority`, and `CommunicationTemplateBodyFormat`.
- Consumes: existing `bossAccounts`, `communicationTemplates`, `organizations`, `contacts`, and `followUps`.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import {
  bossConventionDrafts,
  bossConventionSubmissions,
  bossWorkRequestEvents,
  bossWorkRequests,
  communicationTemplateReviews,
  communicationTemplates,
} from "@/db/schema";

describe("Boss work request schema", () => {
  it("exports the complete durable aggregate", () => {
    expect(Object.keys(bossWorkRequests)).toEqual(expect.arrayContaining([
      "id", "type", "state", "priority", "instructions", "dueAt",
      "createdByOwnerId", "assignedBossAccountId", "deduplicationKey",
      "createdAt", "updatedAt",
    ]));
    expect(Object.keys(bossWorkRequestEvents)).toEqual(expect.arrayContaining([
      "requestId", "actorKind", "actorId", "priorState", "newState", "note", "createdAt",
    ]));
    expect(Object.keys(bossConventionDrafts)).toEqual(expect.arrayContaining([
      "requestId", "bossAccountId", "clientRevision", "payload", "updatedAt",
    ]));
    expect(Object.keys(bossConventionSubmissions)).toEqual(expect.arrayContaining([
      "requestId", "clientMutationId", "payload", "editVersion",
      "appliedOrganizationId", "appliedContactId", "appliedAt",
    ]));
    expect(Object.keys(communicationTemplateReviews)).toEqual(expect.arrayContaining([
      "requestId", "templateId", "templateVersion", "contentFingerprint",
      "subjectSnapshot", "bodySnapshot", "bodyFormatSnapshot", "decision", "note",
    ]));
    expect(Object.keys(communicationTemplates)).toContain("bodyFormat");
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/boss-work-request-schema.test.ts
```

Expected: FAIL because `@/db/schema` does not export the new tables and `communicationTemplates.bodyFormat` is absent.

- [ ] **Step 3: Add the Drizzle schema and repeat-safe SQL migration**

Use these exact value sets:

```ts
export const bossWorkRequestTypeValues = [
  "rapid_convention_notes",
  "email_template_approval",
] as const;
export type BossWorkRequestType = (typeof bossWorkRequestTypeValues)[number];

export const bossWorkRequestStateValues = [
  "waiting_on_dave",
  "in_progress",
  "submitted_to_owner",
  "changes_requested",
  "returned_for_clarification",
  "approved",
  "applied",
  "cancelled",
] as const;

export const bossWorkRequestPriorityValues = ["normal", "high", "urgent"] as const;
export const communicationTemplateBodyFormatValues = ["plain_text", "html"] as const;
```

Database invariants:

- `boss_work_requests.deduplication_key` is unique per assigned Boss account when non-null.
- `boss_work_request_events` is append-only by application convention and indexed by `request_id, created_at`.
- `boss_convention_drafts` has one row per request/Boss and stores validated JSON plus `client_revision >= 0`.
- `boss_convention_submissions` has unique `request_id, client_mutation_id`, `edit_version >= 1`, and nullable applied IDs.
- `communication_template_reviews.request_id` is unique and snapshots the complete reviewed content.
- Check constraints enforce every type, state, priority, actor kind, decision, and body-format value.
- The migration uses `create table if not exists`, guarded `add column if not exists`, and repeat-safe index creation because the aggregate schema may create objects before migration tracking catches up.

Add `body_format text not null default 'plain_text'` to `communication_templates`.

- [ ] **Step 4: Export/register the schema and run verification**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/boss-work-request-schema.test.ts
pnpm --filter @workspace/db typecheck
pnpm --filter @workspace/api-server typecheck
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the schema slice**

```bash
git add lib/db/src/boss-work-request-schema.ts lib/db/src/business-source-schema.ts lib/db/src/index.ts lib/db/src/drizzle-schema.ts lib/db/src/schema/index.ts lib/db/src/migrations.ts lib/db/migrations/20260909b_boss_work_requests.sql artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-schema.test.ts
git commit -m "feat: persist boss review work"
```

---

### Task 2: Implement state, repository, and service boundaries

**Files:**
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-types.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-state.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-state.test.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and value unions.
- Produces:

```ts
export type ConventionNotePayload = {
  convention: string;
  organizationName: string | null;
  personName: string | null;
  roleTitle: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  interestLevel: "hot" | "warm" | "information_only" | "not_interested";
  packageInterest: string | null;
  priorities: string;
  promisedNextStep: string;
  followUpTiming: string | null;
  quickNote: string | null;
};

export interface BossWorkRequestService {
  listForBoss(input: { bossAccountId: string; now: Date }): Promise<BossQueueView>;
  listForOwner(input: { state?: string; type?: string }): Promise<OwnerBossQueueView>;
  create(input: CreateBossWorkRequestInput): Promise<BossWorkRequestView>;
  autosaveConventionDraft(input: {
    requestId: string; bossAccountId: string; clientRevision: number; payload: ConventionNotePayload;
  }): Promise<{ acknowledgedRevision: number }>;
  saveConventionSubmission(input: {
    requestId: string; bossAccountId: string; clientMutationId: string; payload: ConventionNotePayload;
  }): Promise<ConventionSubmissionView>;
  decideTemplate(input: {
    requestId: string; bossAccountId: string; decision: "approved" | "changes_requested"; note: string | null;
  }): Promise<TemplateReviewView>;
}
```

- [ ] **Step 1: Write failing state-machine tests**

```ts
import { describe, expect, it } from "vitest";
import { assertBossWorkTransition, compareBossWorkUrgency } from "./boss-work-request-state";

describe("Boss work request state", () => {
  it("allows only role-correct workflow transitions", () => {
    expect(() => assertBossWorkTransition("waiting_on_dave", "in_progress", "boss")).not.toThrow();
    expect(() => assertBossWorkTransition("in_progress", "submitted_to_owner", "boss")).not.toThrow();
    expect(() => assertBossWorkTransition("waiting_on_dave", "approved", "boss")).not.toThrow();
    expect(() => assertBossWorkTransition("waiting_on_dave", "changes_requested", "boss")).not.toThrow();
    expect(() => assertBossWorkTransition("submitted_to_owner", "applied", "owner")).not.toThrow();
    expect(() => assertBossWorkTransition("waiting_on_dave", "applied", "boss")).toThrow("Invalid Boss work transition");
  });

  it("orders overdue, urgent, due, then oldest", () => {
    const now = new Date("2026-09-09T18:00:00.000Z");
    const rows = [
      { id: "normal", priority: "normal", dueAt: null, createdAt: new Date("2026-09-01") },
      { id: "urgent", priority: "urgent", dueAt: null, createdAt: new Date("2026-09-08") },
      { id: "overdue", priority: "normal", dueAt: new Date("2026-09-08"), createdAt: new Date("2026-09-08") },
    ];
    expect(rows.sort((a, b) => compareBossWorkUrgency(a, b, now)).map((row) => row.id))
      .toEqual(["overdue", "urgent", "normal"]);
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/boss-work-request-state.test.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.test.ts
```

Expected: FAIL because the state and service modules do not exist.

- [ ] **Step 3: Implement minimal typed repository and service**

Rules enforced in service/repository transactions:

- Opening a form may transition `waiting_on_dave -> in_progress`.
- Autosave upserts only when `clientRevision` is greater than the stored revision and returns the stored acknowledged revision.
- A convention save validates that either `organizationName` or `personName` is non-empty.
- Repeating the same `clientMutationId` returns the same submission.
- A saved entry does not clear or overwrite a newer draft.
- `changes_requested` requires a non-empty note.
- Template decisions recompute SHA-256 from `templateVersion + subjectTemplate + bodyTemplate + bodyFormat` and reject `409 TEMPLATE_REVISION_CHANGED` on mismatch.
- Approval and template activation happen in one transaction.
- Every state mutation inserts one event with actor and prior/new state.
- Queue reads scope by `assignedBossAccountId` and use the Task 2 urgency comparator.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/boss-work-request-state.test.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the domain slice**

```bash
git add artifacts/api-server/src/features/boss-work-requests
git commit -m "feat: add boss review workflow service"
```

---

### Task 3: Add Boss and Owner HTTP boundaries

**Files:**
- Create: `artifacts/api-server/src/routes/boss-work-requests.ts`
- Create: `artifacts/api-server/src/routes/boss-work-requests-owner.ts`
- Create: `artifacts/api-server/src/routes/boss-work-requests.test.ts`
- Create: `artifacts/api-server/src/routes/boss-work-requests-owner.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/boss-dashboard.ts`
- Modify: `artifacts/api-server/src/routes/boss-workspace.test.ts`

**Interfaces:**
- Consumes: `BossWorkRequestService` from Task 2 and existing `requireBoss` / `requireOwnerMiddleware`.
- Produces Boss endpoints:
  - `GET /boss/work-requests`
  - `GET /boss/work-requests/:requestId`
  - `PATCH /boss/work-requests/:requestId/convention-draft`
  - `POST /boss/work-requests/:requestId/convention-submissions`
  - `PATCH /boss/work-requests/:requestId/convention-submissions/:submissionId`
  - `POST /boss/work-requests/:requestId/template-decision`
- Produces Owner endpoints:
  - `GET /boss-work-requests`
  - `POST /boss-work-requests`
  - `POST /boss-work-requests/:requestId/cancel`
  - `POST /boss-work-requests/:requestId/return-for-clarification`
  - `GET /boss-work-requests/:requestId/convention-submissions/:submissionId/preview`
  - `POST /boss-work-requests/:requestId/convention-submissions/:submissionId/apply`
  - `POST /boss-work-requests/:requestId/template-revision`

- [ ] **Step 1: Write failing route-boundary tests**

```ts
it("mounts Boss work before the owner gate and Owner work after it", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  expect(source.indexOf("router.use(bossWorkRequestsRouter)"))
    .toBeLessThan(source.indexOf("router.use(requireOwnerMiddleware)"));
  expect(source.indexOf("router.use(ownerBossWorkRequestsRouter)"))
    .toBeGreaterThan(source.indexOf("router.use(requireOwnerMiddleware)"));
});

it("rejects a Boss attempting Owner application", async () => {
  await request(app)
    .post("/api/boss-work-requests/request-1/convention-submissions/submission-1/apply")
    .send({ organizationId: "00000000-0000-4000-8000-000000000001" })
    .expect(401);
});
```

Also test 400 validation, 403 cross-Boss access, 404 unknown IDs, 409 revision conflicts, and idempotent repeated saves/applies.

- [ ] **Step 2: Run route tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/boss-work-requests.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts artifacts/api-server/src/routes/boss-workspace.test.ts
```

Expected: FAIL because the routers are absent.

- [ ] **Step 3: Implement routers and mount them at the correct auth boundaries**

Boss payload schemas must be strict:

```ts
const autosaveSchema = z.object({
  clientRevision: z.number().int().nonnegative(),
  payload: conventionNotePayloadSchema,
}).strict();

const saveSubmissionSchema = z.object({
  clientMutationId: z.string().uuid(),
  payload: conventionNotePayloadSchema,
}).strict();

const templateDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(4000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.note) {
    context.addIssue({ code: "custom", message: "Tell Desiree what should change.", path: ["note"] });
  }
});
```

Return stable error envelopes: `{ error: string, code: string }`. Do not expose another Boss account's request existence.

Add `bossWork: { openCount, overdueCount, recentlyCompletedCount }` to `GET /boss/dashboard`; detailed rows stay in the dedicated endpoint.

- [ ] **Step 4: Run route and regression tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/boss-work-requests.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts artifacts/api-server/src/routes/boss-workspace.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the HTTP slice**

```bash
git add artifacts/api-server/src/routes/boss-work-requests.ts artifacts/api-server/src/routes/boss-work-requests-owner.ts artifacts/api-server/src/routes/boss-work-requests.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/boss-dashboard.ts artifacts/api-server/src/routes/boss-workspace.test.ts
git commit -m "feat: expose boss review queues"
```

---

### Task 4: Apply reviewed convention entries atomically

**Files:**
- Create: `artifacts/api-server/src/features/boss-work-requests/convention-apply-service.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/convention-apply-service.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-types.ts`
- Modify: `artifacts/api-server/src/routes/boss-work-requests-owner.ts`

**Interfaces:**
- Consumes existing `organizations`, `contacts`, `organizationContacts`, `contactPhones`, `activities`, and `followUps`.
- Produces:

```ts
export type ConventionMatchChoice =
  | { kind: "existing"; organizationId: string; contactId: string | null }
  | { kind: "new"; organizationName: string };

export type ConventionApplyPreview = {
  submissionId: string;
  candidates: Array<{
    organizationId: string;
    organizationName: string;
    contactId: string | null;
    contactName: string | null;
    reasons: string[];
  }>;
  proposed: {
    organizationAction: "use_existing" | "create";
    contactAction: "none" | "use_existing" | "create";
    addActivity: true;
    addFollowUp: boolean;
  };
  blockingReason: "match_choice_required" | null;
};

export interface ConventionApplyService {
  preview(submissionId: string): Promise<ConventionApplyPreview>;
  apply(input: {
    requestId: string;
    submissionId: string;
    choice: ConventionMatchChoice;
    expectedEditVersion: number;
    ownerId: string;
  }): Promise<{ organizationId: string; contactId: string | null; replayed: boolean }>;
}
```

- [ ] **Step 1: Write failing PGlite integration tests**

Prove:

- no CRM rows are written by `preview`;
- ambiguous candidates return `match_choice_required`;
- existing organization/contact selection updates only explicit non-empty contact values;
- new selection creates one organization and optional contact relationship;
- one activity records convention source and links the submission ID;
- follow-up is created only when timing is supplied;
- a repeated apply returns the original IDs with `replayed: true`;
- an edit-version mismatch returns a conflict before writes;
- any insert failure rolls the whole transaction back.

- [ ] **Step 2: Run the integration test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/convention-apply-service.pglite.test.ts
```

Expected: FAIL because `ConventionApplyService` is absent.

- [ ] **Step 3: Implement deterministic matching and one-transaction apply**

Candidate rules, in order:

1. exact normalized email on an existing contact;
2. exact normalized phone;
3. exact normalized organization name plus city/state;
4. exact normalized organization name;
5. no automatic selection.

Name similarity alone never chooses a profile. Multiple candidates always require Owner choice.

Use the submission's applied IDs as the replay record. Lock the submission row, compare `expectedEditVersion`, and if `appliedAt` is already set return the stored IDs without new writes.

Store the convention activity with source `boss_convention_note`, `organizationId`, optional `contactId`, and a metadata/source link to the submission. Use the existing follow-up fields and defaults; never infer a due date from vague text.

- [ ] **Step 4: Run integration, route, and type tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests/convention-apply-service.pglite.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the CRM application slice**

```bash
git add artifacts/api-server/src/features/boss-work-requests/convention-apply-service.ts artifacts/api-server/src/features/boss-work-requests/convention-apply-service.pglite.test.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-types.ts artifacts/api-server/src/routes/boss-work-requests-owner.ts
git commit -m "feat: review and apply convention notes"
```

---

### Task 5: Build Dave's opening queue and rapid-entry experience

**Files:**
- Create: `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-types.ts`
- Create: `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-api.ts`
- Create: `artifacts/adventure-zone/src/features/boss-work-requests/use-convention-draft.ts`
- Create: `artifacts/adventure-zone/src/features/boss-work-requests/use-convention-draft.test.tsx`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/BossAttentionQueue.tsx`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/RapidConventionNotesForm.tsx`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/RapidConventionNotesForm.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/BossWorkRequestPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BossHomePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BossHomePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/boss/boss-shell.tsx`

**Interfaces:**
- Consumes Task 3 Boss endpoints.
- Produces `useConventionDraft(requestId)` with:

```ts
type ConventionDraftController = {
  value: ConventionNotePayload;
  update(next: ConventionNotePayload): void;
  saveState: "idle" | "saving" | "saved" | "not_synced";
  acknowledgedRevision: number;
  submitAndReset(): Promise<ConventionSubmissionView>;
  restoreAvailable: boolean;
};
```

- [ ] **Step 1: Write failing hook and form tests**

```ts
it("does not clear until submission persistence succeeds", async () => {
  const deferred = createDeferred<ConventionSubmissionView>();
  mockSaveSubmission.mockReturnValue(deferred.promise);
  render(<RapidConventionNotesForm request={request} />);
  await user.type(screen.getByLabelText("Event or organization"), "Logan Summerfest");
  await user.click(screen.getByRole("button", { name: "Save & Start Next" }));
  expect(screen.getByLabelText("Event or organization")).toHaveValue("Logan Summerfest");
  deferred.resolve(savedSubmission);
  await waitFor(() => expect(screen.getByLabelText("Event or organization")).toHaveValue(""));
});

it("keeps newer edits dirty when an older autosave returns", async () => {
  const controller = renderHook(() => useConventionDraft("request-1")).result;
  act(() => controller.current.update(payload("First")));
  const firstSave = pendingAutosaves.shift()!;
  act(() => controller.current.update(payload("Second")));
  firstSave.resolve({ acknowledgedRevision: 1 });
  await waitFor(() => expect(controller.current.saveState).toBe("saving"));
});
```

Also test localStorage restoration, `not_synced`, validation, Saved Today editing, disabled edits after application, refocus after save, and no horizontal overflow at 360px.

- [ ] **Step 2: Run client tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/features/boss-work-requests/use-convention-draft.test.tsx src/components/boss-work-requests/RapidConventionNotesForm.test.tsx src/pages/BossHomePage.test.tsx
```

Expected: FAIL because the new UI modules are absent.

- [ ] **Step 3: Implement the queue, detail route, and revision-safe autosave**

Use local key `boss-convention-draft:<bossAccountId>:<requestId>`. Increment `clientRevision` on every field change. Debounce server autosave by 600ms. Clear dirty state only when the acknowledged revision equals the current local revision.

Boss home layout order:

1. heading `Needs Your Attention`;
2. open/overdue summary;
3. `BossAttentionQueue`;
4. collapsible `Recently Completed`;
5. existing stat strip and operational sections.

Add `/boss/work/:requestId` before the `/boss` catch-all route. Rename the Boss nav label from `Home` to `Needs Your Attention` while keeping href `/boss`.

- [ ] **Step 4: Run focused Boss tests, Boss suite, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/features/boss-work-requests/use-convention-draft.test.tsx src/components/boss-work-requests/RapidConventionNotesForm.test.tsx src/pages/BossHomePage.test.tsx
pnpm --filter @workspace/adventure-zone test:boss
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit Dave's UI slice**

```bash
git add artifacts/adventure-zone/src/features/boss-work-requests artifacts/adventure-zone/src/components/boss-work-requests/BossAttentionQueue.tsx artifacts/adventure-zone/src/components/boss-work-requests/RapidConventionNotesForm.tsx artifacts/adventure-zone/src/components/boss-work-requests/RapidConventionNotesForm.test.tsx artifacts/adventure-zone/src/pages/BossWorkRequestPage.tsx artifacts/adventure-zone/src/pages/BossHomePage.tsx artifacts/adventure-zone/src/pages/BossHomePage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/boss/boss-shell.tsx
git commit -m "feat: add boss attention and rapid convention entry"
```

---

### Task 6: Add exact email review and approval-required template editing

**Files:**
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BossWorkRequestPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx`
- Modify: `artifacts/api-server/src/routes/communication-templates.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts`
- Modify: `artifacts/adventure-zone/src/components/office/office-email-editor.tsx`

**Interfaces:**
- Consumes Task 2 exact fingerprint and Task 3 template-decision endpoint.
- Produces `RenderedTemplate.bodyFormat: "plain_text" | "html"`.
- Produces explicit Gmail draft input `bodyFormat?: "plain_text" | "html"`.

- [ ] **Step 1: Write failing preview, approval, and MIME tests**

Client assertions:

```ts
expect(screen.getByTitle("Recipient email preview")).toHaveAttribute("sandbox", "");
expect(screen.queryByRole("textbox", { name: "Email body" })).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Request Changes" }));
expect(await screen.findByText("Tell Desiree what should change.")).toBeVisible();
```

Server assertions:

```ts
const mime = decodeRaw(buildGmailRawMessage({
  to: "lead@example.com",
  subject: "See you at the convention",
  body: "<p>Hello</p>",
  bodyFormat: "html",
}));
expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
```

Also prove an approved fingerprint activates the template, a changed fingerprint returns 409, saving an active company template returns it to draft/review-needed state, and legacy plain-text callers still produce `text/plain`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/EmailTemplateReview.test.tsx src/pages/SettingsCommunicationTemplatesPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/routes/boss-work-requests.test.ts
```

Expected: FAIL because formatted review and approval submission are absent.

- [ ] **Step 3: Implement safe preview, revision submission, and MIME format propagation**

- Render HTML only inside `<iframe sandbox="" title="Recipient email preview" srcDoc={html} />`.
- For plain text, escape and wrap text in a minimal HTML document before assigning `srcDoc`.
- Display purpose, campaign stage, dynamic-field list, and incomplete-image warning outside the iframe.
- Replace the direct `Activate` button for non-active company templates with `Send to Dave for approval`.
- Leave archive behavior and already-active legacy templates intact.
- On any content save, compute a new template version/fingerprint and require a new Boss review before reactivation.
- Extend Gmail MIME creation so `bodyFormat: "html"` uses `text/html; charset=UTF-8`; omitted format remains `text/plain`.
- Carry `bodyFormat` from template render to Office draft persistence and Gmail draft creation.

- [ ] **Step 4: Run focused suites and typechecks**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/EmailTemplateReview.test.tsx src/pages/SettingsCommunicationTemplatesPage.test.tsx
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/routes/boss-work-requests.test.ts
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the template approval slice**

```bash
git add artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.test.tsx artifacts/adventure-zone/src/pages/BossWorkRequestPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx artifacts/adventure-zone/src/components/office/office-email-editor.tsx artifacts/api-server/src/routes/communication-templates.ts artifacts/api-server/src/features/communication-templates artifacts/api-server/src/features/google-workspace/google-api-client.ts artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts
git commit -m "feat: require boss approval for email templates"
```

---

### Task 7: Build the Owner review workspace

**Files:**
- Create: `artifacts/adventure-zone/src/features/boss-work-requests/owner-boss-work-request-api.ts`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/OwnerConventionReview.tsx`
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/OwnerConventionReview.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/DaveRequestsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/DaveRequestsPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Consumes Task 3 Owner endpoints and Task 4 match/apply contract.
- Produces Owner route `/dave-requests`.

- [ ] **Step 1: Write failing Owner workflow tests**

Prove:

- tabs show `Needs Dave`, `Submitted to Me`, `Changes Requested`, and `Completed`;
- submissions group by convention;
- a request form offers only the two Release 1 request types;
- instructions are required, while due date is optional;
- ambiguous entries cannot apply until the Owner chooses an existing profile or confirms a new one;
- `Approve & Add to Profiles` sends `expectedEditVersion`;
- an applied entry becomes read-only and links to the profile;
- `Return for Clarification` requires a note;
- Today shows a badge when submitted work or change requests exist.

- [ ] **Step 2: Run Owner client tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/OwnerConventionReview.test.tsx src/pages/DaveRequestsPage.test.tsx src/pages/TodayPage.test.tsx
```

Expected: FAIL because the Owner workspace is absent.

- [ ] **Step 3: Implement the Owner page, route, navigation, and Today badge**

- Add lazy route `/dave-requests` in the Owner app.
- Add `Dave Requests` to desktop navigation and the appropriate mobile overflow/navigation group without displacing higher-frequency Today, Profiles, Schedule, Calls, and Email destinations.
- Fetch the match preview before enabling apply.
- Show exact proposed organization/contact/activity/follow-up mutations.
- Refresh only the affected tab after create, return, revise, or apply.
- Keep completed history collapsed by default.
- Add a Today attention card that links to `/dave-requests` and degrades to zero count if its summary read fails; it must not break the existing Today dashboard.

- [ ] **Step 4: Run Owner, routing, type, and build checks**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/OwnerConventionReview.test.tsx src/pages/DaveRequestsPage.test.tsx src/pages/TodayPage.test.tsx src/App.office-routing.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit the Owner workspace slice**

```bash
git add artifacts/adventure-zone/src/features/boss-work-requests/owner-boss-work-request-api.ts artifacts/adventure-zone/src/components/boss-work-requests/OwnerConventionReview.tsx artifacts/adventure-zone/src/components/boss-work-requests/OwnerConventionReview.test.tsx artifacts/adventure-zone/src/pages/DaveRequestsPage.tsx artifacts/adventure-zone/src/pages/DaveRequestsPage.test.tsx artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.test.tsx artifacts/adventure-zone/src/components/navigation/app-shell.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add owner review for dave requests"
```

---

### Task 8: Convert the approved convention campaign drafts

**Files:**
- Create: `artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.ts`
- Create: `artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.test.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-seed.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Modify: `artifacts/api-server/src/routes/communication-templates.ts`

**Interfaces:**
- Consumes the current approved Gmail draft source for the pre-convention, during-convention, and post-convention campaign variants.
- Produces canonical company templates with `bodyFormat: "html"`, stable internal codes, recipient-facing subjects, exact visual markup/assets, and initial Dave approval requests.
- Produces placeholder `{{earlyBirdDeadline}}`, calculated from intended send date by the centralized Early Bird campaign rule.

- [ ] **Step 1: Capture the approved Gmail draft snapshots and write failing seed tests**

Create one immutable seed entry for every approved convention variant. Each entry contains:

```ts
type ConventionCampaignSeed = {
  code: string;
  templateVersion: string;
  name: string;
  stage: "pre_convention" | "during_convention" | "post_convention";
  recipientSubject: string;
  htmlTemplate: string;
  requiredPlaceholders: TemplatePlaceholder[];
  sourceGmailDraftId: string;
  sourceDigest: string;
};
```

The test must assert:

- all approved draft IDs appear exactly once;
- all three stages are represented;
- purpose labels are not reused as recipient subjects;
- every image has non-empty alt text and an HTTPS source;
- links match the approved drafts;
- mobile wrapper width and package-card pink text backgrounds are preserved;
- the second slide uses the approved `Slide into action!` label and approved image order;
- the normal signature is not duplicated below the branded footer;
- each eligible template contains exactly one Early Bird block and `{{earlyBirdDeadline}}`;
- the copy describes a shared Early Bird offer and does not say `30 days from this email` or `winter booking promo`;
- seed state is `draft`, with one deduplicated `email_template_approval` request per template version.

- [ ] **Step 2: Run seed tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.test.ts
```

Expected: FAIL because the convention seed does not exist.

- [ ] **Step 3: Implement exact seed preservation and centralized Early Bird rendering**

- Store the captured approved HTML verbatim except for approved dynamic placeholders.
- Use stable codes prefixed `convention_` and a content-derived version string.
- Calculate `earlyBirdDeadline` from the intended send date using the active Early Bird rule.
- Render the date as `Month D, YYYY`.
- Suppress the entire Early Bird block when the campaign is inactive rather than leaving an empty heading or stale date.
- On seed startup, update only rows that still match a prior seed digest; never overwrite an Owner-edited template.
- Create a deduplicated Dave approval request for each current seed version.
- Gmail drafts remain provenance only; future edits happen in the app.

- [ ] **Step 4: Run seed, renderer, template-route, and work-request tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.test.ts artifacts/api-server/src/features/communication-templates/communication-template-renderer.test.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the converted campaign templates**

```bash
git add artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.ts artifacts/api-server/src/features/communication-templates/convention-campaign-template-seed.test.ts artifacts/api-server/src/features/communication-templates/communication-template-seed.ts artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts artifacts/api-server/src/features/communication-templates/communication-template-types.ts artifacts/api-server/src/routes/communication-templates.ts
git commit -m "feat: convert convention drafts to reviewed templates"
```

---

### Task 9: Final regression and release proof

**Files:**
- Create: `docs/acceptance/boss-review-input-workspace-v1-checklist.md`
- Modify: `artifacts/adventure-zone/package.json`
- Create: `.github/workflows/boss-review-input-workspace-ci.yml`

**Interfaces:**
- Consumes every earlier task.
- Produces a repeatable CI/acceptance gate.

- [ ] **Step 1: Add a dedicated test script and CI workflow**

Add `test:boss-review-input` to the client package and run:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests artifacts/api-server/src/features/communication-templates artifacts/api-server/src/routes/boss-work-requests.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/routes/boss-workspace.test.ts artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts
pnpm --filter @workspace/adventure-zone test:boss-review-input
```

The CI workflow also runs both workspace typechecks and the client/API builds.

- [ ] **Step 2: Run the complete focused verification**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/boss-work-requests artifacts/api-server/src/features/communication-templates artifacts/api-server/src/routes/boss-work-requests.test.ts artifacts/api-server/src/routes/boss-work-requests-owner.test.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/routes/boss-workspace.test.ts artifacts/api-server/src/features/google-workspace/google-gmail-draft.test.ts
pnpm --filter @workspace/adventure-zone test:boss-review-input
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
git diff --check
```

Expected: all tests, typechecks, builds, and whitespace checks PASS.

- [ ] **Step 3: Perform mobile and interruption acceptance checks**

Document evidence for:

1. Dave sign-in lands on `Needs Your Attention`.
2. 360px-wide rapid entry has no horizontal scrolling.
3. Save failure leaves the filled form visible and marks it `Not synced`.
4. Refresh restores the unfinished draft.
5. Successful `Save & Start Next` adds Saved Today, clears, and focuses the first field.
6. Repeated submission and apply requests create no duplicates.
7. Dave cannot reach Owner endpoints.
8. Owner can return a submission with a note and apply an unambiguous submission once.
9. HTML preview is sandboxed and visually matches the source draft at mobile and desktop widths.
10. Dave's approval activates only the reviewed revision.
11. A later edit requires renewed approval.
12. Existing Boss navigation and operational pages remain usable.

- [ ] **Step 4: Run a final migration/readiness check against an empty and an already-current database**

Run the repository's database bootstrap/migration checks twice. The second run must make no schema changes and must not create duplicate work requests or seed templates.

- [ ] **Step 5: Commit release proof**

```bash
git add docs/acceptance/boss-review-input-workspace-v1-checklist.md artifacts/adventure-zone/package.json .github/workflows/boss-review-input-workspace-ci.yml
git commit -m "test: verify boss review and input workspace"
```

- [ ] **Step 6: Request code review before merge**

Use `superpowers:requesting-code-review`, address verified findings, rerun Task 9 Step 2, then use `superpowers:finishing-a-development-branch` for the merge decision.
