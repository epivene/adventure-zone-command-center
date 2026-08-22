# Leg Event Pre/Post Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Leg Manager check-in/check-out lifecycle so check-in launches a resumable pre-event safety checklist, checkout requires a post-event condition checklist or explicit exception, unsafe results update resource availability, and all work remains offline-capable.

**Architecture:** Keep `event_leg_lifecycle` as the arrival/departure/wrap-up source of truth and add a separate checklist subsystem with template items, event/resource-scoped results, attachments, and condition follow-up issues. Check-in persists first, then creates/resumes the pre-event run. Checkout becomes a two-stage flow: start the post-event run, then record final departure only after completion or an explicit exception. Reuse the existing manager mutation/blob queues for offline result/photo sync.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing Leg Manager auth, existing resource assignment/status system, existing `manager-sync-queue` and `manager-blob-queue`.

**Spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

## Global Constraints

- The uploaded inflatable inspection sheet is the base safety source, not a weekly grid to copy literally.
- Release 1 has two required phases: `pre_event` during check-in and `post_event` during checkout.
- Check-in arrival time/location must persist before the pre-event checklist begins and must survive interruption.
- Event state after arrival is **Checked in — pre-event checklist needed** until the checklist is complete.
- **Ready to operate** requires a completed pre-event checklist with no unresolved site-wide unsafe result.
- An unsafe result on one attraction blocks that attraction, not automatically the whole event.
- A site-wide unsafe result blocks Ready to Operate until corrected or owner/admin overrides with a reason.
- `Needs work, but safe` requires a note and creates follow-up work without automatically removing the resource from service.
- `Unsafe — cannot operate` requires a note and a photo when practical, marks the affected resource unavailable, and creates a condition issue.
- Normal final checkout requires the post-event checklist. `Unable to complete` is allowed only with a required reason and owner/admin visibility.
- Final checkout/departure persists before the existing event wrap-up opens.
- Checklist work must be resumable and offline-capable; retries must be idempotent.
- Leg Managers can operate only on events assigned to their leg. Owner/admin can view all runs and override state with attribution.
- Office Coordinator cannot complete operational safety checklists.

---

### Task 1: Add checklist, attachment, and resource-condition schema

**Files:**
- Create: `lib/db/src/event-checklist-schema.ts`
- Create: `lib/db/migrations/20260822_event_checklists.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Test: `artifacts/api-server/src/features/leg-manager/event-checklist-schema.test.ts`

**Interfaces:**

```ts
export const checklistPhaseValues = ["pre_event", "post_event"] as const;
export const checklistRunStateValues = ["in_progress", "completed", "unable_to_complete"] as const;
export const checklistResultValues = ["acceptable", "needs_work_safe", "unsafe", "not_applicable"] as const;
export const resourceConditionIssueStateValues = ["open", "resolved"] as const;
```

**Schema:**

```text
event_checklist_templates
  id uuid PK
  code text UNIQUE NOT NULL
  name text NOT NULL
  phase text NOT NULL CHECK pre_event|post_event
  version integer NOT NULL
  active boolean NOT NULL default true
  created_at / updated_at

event_checklist_template_items
  id uuid PK
  template_id uuid NOT NULL FK cascade
  code text NOT NULL
  label text NOT NULL
  scope text NOT NULL CHECK site|resource
  applicability_tags text[] NOT NULL default '{}'
  safety_critical boolean NOT NULL default false
  sort_order integer NOT NULL
  active boolean NOT NULL default true
  UNIQUE(template_id, code)

event_checklist_runs
  id uuid PK
  client_mutation_id uuid NOT NULL UNIQUE
  booking_id uuid NOT NULL FK bookings cascade
  leg_id uuid NOT NULL FK travel_legs restrict
  template_id uuid NOT NULL FK restrict
  phase text NOT NULL
  state text NOT NULL
  started_at timestamptz NOT NULL
  completed_at timestamptz NULL
  unable_reason text NULL
  completed_by_manager_id uuid NULL
  created_at / updated_at
  UNIQUE(booking_id, leg_id, phase)

event_checklist_item_results
  id uuid PK
  run_id uuid NOT NULL FK cascade
  template_item_id uuid NOT NULL FK restrict
  resource_id uuid NULL FK resources set null
  item_code_snapshot text NOT NULL
  item_label_snapshot text NOT NULL
  resource_name_snapshot text NULL
  result text NULL CHECK acceptable|needs_work_safe|unsafe|not_applicable
  note text NULL
  client_mutation_id uuid NOT NULL UNIQUE
  updated_at timestamptz NOT NULL
  UNIQUE(run_id, template_item_id, resource_id)

event_checklist_attachments
  id uuid PK
  result_id uuid NOT NULL FK cascade
  mime_type text NOT NULL
  storage_key text NULL
  uploaded_at timestamptz NULL
  client_mutation_id uuid NOT NULL UNIQUE
  created_at timestamptz NOT NULL

resource_condition_issues
  id uuid PK
  resource_id uuid NULL FK resources set null
  booking_id uuid NOT NULL FK bookings cascade
  checklist_result_id uuid NOT NULL FK restrict
  severity text NOT NULL CHECK needs_work_safe|unsafe
  state text NOT NULL CHECK open|resolved
  summary text NOT NULL
  note text NOT NULL
  created_at / resolved_at timestamptz
```

- [ ] **Step 1: Write the failing schema test**

```ts
import { describe, expect, it } from "vitest";
import {
  eventChecklistRuns,
  eventChecklistItemResults,
  eventChecklistAttachments,
  resourceConditionIssues,
} from "@workspace/db";

describe("event checklist schema", () => {
  it("exports queryable run, result, attachment, and condition tables", () => {
    expect(eventChecklistRuns.clientMutationId).toBeDefined();
    expect(eventChecklistItemResults.resourceId).toBeDefined();
    expect(eventChecklistAttachments.storageKey).toBeDefined();
    expect(resourceConditionIssues.severity).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-schema.test.ts
```

- [ ] **Step 3: Implement migration + Drizzle schema**

Add indexes on `(booking_id, leg_id, phase)`, `(leg_id, state)`, `(run_id, result)`, `(resource_id, state)`, and attachment result id. Keep item results normalized; do not store the completed checklist as one JSON blob.

- [ ] **Step 4: Export schema and typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/event-checklist-schema.ts lib/db/migrations/20260822_event_checklists.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/leg-manager/event-checklist-schema.test.ts
git commit -m "feat: add event checklist data model"
```

---

### Task 2: Seed the pre-event and post-event checklist templates

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/event-checklist-seed.ts`
- Test: `artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Interfaces:**

```ts
export async function ensureEventChecklistTemplates(database: DrizzleDatabase): Promise<void>;
```

**Pre-event resource items derived from the uploaded inspection sheet:**

```ts
const PRE_EVENT_RESOURCE_ITEMS = [
  ["ride_surface_damage", "Inspect the entire inflatable for holes or damage, especially stairways. Holes larger than a quarter must be repaired before operation.", ["inflatable"], true],
  ["safety_signage", "Verify required safety signage is attached to the attraction.", ["inflatable"], true],
  ["blower_nozzle", "Verify each blower nozzle is securely attached to its blower.", ["blower_powered"], true],
  ["power_cords", "Inspect blower and extension cords and verify connections are secure.", ["blower_powered"], true],
  ["anchor_each_point", "Verify every anchoring point has the required stake or approved ballast attached.", ["inflatable"], true],
  ["hook_stakes", "Verify hook stakes are flush with the ground where hook stakes are used.", ["inflatable"], true],
  ["straight_stakes", "Verify straight stakes are vertical, have no more than 12 inches exposed above ground, and have a cone or tennis ball covering the top.", ["inflatable"], true],
  ["sections_attached", "Verify inflatable sections are securely attached together.", ["multi_section"], true],
  ["straps_anchor_wear", "Inspect straps and anchoring points for security and excessive wear.", ["inflatable"], true],
];

const PRE_EVENT_SITE_ITEMS = [
  ["walkway_cords_matted", "Verify cords crossing walkways are properly covered or matted.", true],
  ["walkways_clear", "Verify walkways are clear and free from obstruction.", true],
  ["loose_items_garbage", "Remove loose items and garbage inside and around attractions.", false],
  ["mats_flat", "Verify all mats are lying flat and straight.", true],
  ["site_anchoring_method", "Confirm the anchoring method is appropriate for the event surface and setup area.", true],
];
```

**Post-event resource items:**

```ts
const POST_EVENT_RESOURCE_ITEMS = [
  ["new_damage", "Inspect for new holes, tears, seam damage, or other damage after operation.", ["inflatable"], true],
  ["anchor_hardware_complete", "Confirm stakes, ballast hardware, straps, and attachment hardware are accounted for before loading.", ["inflatable"], false],
  ["blower_condition", "Inspect blowers, blower cords, and extension cords for damage before packing.", ["blower_powered"], false],
  ["sections_complete", "Confirm all sections and removable pieces are present and ready for load-out.", ["multi_section"], false],
  ["cleaning_drying", "Record whether the attraction needs additional cleaning or drying before storage or its next event.", ["inflatable"], false],
  ["resource_ready_next_event", "Confirm whether this attraction is safe and ready for its next assignment.", [], true],
];

const POST_EVENT_SITE_ITEMS = [
  ["site_cleanup", "Confirm Adventure Zone equipment, loose items, and garbage have been cleared from the operating area.", false],
  ["missing_equipment", "Confirm no Adventure Zone equipment or components are missing from load-out.", true],
  ["site_damage_note", "Record any event-site damage or condition that needs owner/admin follow-up.", false],
];
```

- [ ] **Step 1: Write template content/idempotency tests**

Assert the pre-event template contains every source-derived safety category above, the post-event template contains the designed condition/load-out items, and repeated seeding does not duplicate templates/items.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts
```

- [ ] **Step 3: Implement idempotent template seed**

Use stable template codes `pre_event_v1` and `post_event_v1`; use stable item codes. Seed after port bind, following the same non-blocking maintenance approach as other feature seeders.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/leg-manager/event-checklist-seed.ts artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts artifacts/api-server/src/index.ts
git commit -m "feat: seed event safety checklists"
```

---

### Task 3: Add resource checklist tags to inventory settings

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/migrations/20260822_event_checklists.sql`
- Modify: `artifacts/api-server/src/features/resources/resource-input.ts`
- Modify: `artifacts/api-server/src/features/resources/resource-repository.ts`
- Modify: `artifacts/adventure-zone/src/features/resources/resource-repository.ts`
- Modify: `artifacts/adventure-zone/src/components/resources/resource-inventory-editor.tsx`
- Test: `artifacts/api-server/src/features/resources/resource-settings.test.ts`
- Test: `artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx`

**Interfaces:**

```ts
export const resourceChecklistTagValues = [
  "inflatable",
  "blower_powered",
  "wet_attraction",
  "multi_section",
  "action_pursuit",
  "carnival_game",
  "trailer_shared",
] as const;

resourceInputSchema.checklistTags: z.array(z.enum(resourceChecklistTagValues))
ResourceInventoryRecord.checklistTags: ResourceChecklistTag[]
```

- [ ] **Step 1: Write failing strict-schema and repository tests**

Prove unknown tags reject, duplicate tags reject, and list/upsert round-trips tags.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-settings.test.ts
```

- [ ] **Step 3: Add `resources.checklist_tags text[] NOT NULL DEFAULT '{}'`**

Do not infer safety tags from free-text names at request time. Tags are explicit configuration.

- [ ] **Step 4: Add checklist-tag controls to the resource editor**

Use simple checkboxes; no drag-and-drop. Explain that tags control which inspection items appear for a resource.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-settings.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx
pnpm run typecheck
git add lib/db/src/schema/index.ts lib/db/migrations/20260822_event_checklists.sql artifacts/api-server/src/features/resources/resource-input.ts artifacts/api-server/src/features/resources/resource-repository.ts artifacts/adventure-zone/src/features/resources/resource-repository.ts artifacts/adventure-zone/src/components/resources/resource-inventory-editor.tsx artifacts/api-server/src/features/resources/resource-settings.test.ts artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx
git commit -m "feat: tag resources for event checklists"
```

---

### Task 4: Build checklist run generation, incremental result saving, and condition issues

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/event-checklist-types.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-checklist-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-checklist-service.ts`
- Create: `artifacts/api-server/src/features/leg-manager/resource-condition-service.ts`
- Test: `artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts`
- Test: `artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts`

**Interfaces:**

```ts
export type EventChecklistView = {
  id: string;
  bookingId: string;
  legId: string;
  phase: "pre_event" | "post_event";
  state: "in_progress" | "completed" | "unable_to_complete";
  startedAt: string;
  completedAt: string | null;
  unableReason: string | null;
  items: Array<{
    resultId: string;
    itemCode: string;
    label: string;
    scope: "site" | "resource";
    resourceId: string | null;
    resourceName: string | null;
    safetyCritical: boolean;
    result: "acceptable" | "needs_work_safe" | "unsafe" | "not_applicable" | null;
    note: string | null;
    photoCount: number;
  }>;
};

export async function ensureChecklistRun(input: {
  bookingId: string;
  legId: string;
  phase: "pre_event" | "post_event";
  clientMutationId: string;
}): Promise<EventChecklistView>;

export async function saveChecklistResult(input: {
  resultId: string;
  legId: string;
  result: "acceptable" | "needs_work_safe" | "unsafe" | "not_applicable";
  note: string | null;
  clientMutationId: string;
}): Promise<EventChecklistView>;
```

Generation rules:
- Site items create one result each.
- Resource items create one result per assigned resource when the item's `applicability_tags` is empty or intersects the resource's `checklist_tags`.
- Result rows snapshot item text and resource name at run creation so later settings edits do not rewrite historical checklists.

Validation rules:
- `needs_work_safe` requires nonblank note.
- `unsafe` requires nonblank note.
- `not_applicable` on a safety-critical item requires nonblank note.
- Completing a run requires every generated result to have a result value.

Condition behavior:
- `needs_work_safe` creates/updates an open `resource_condition_issue` but leaves resource status unchanged.
- `unsafe` on a resource creates/updates an issue and sets `resources.status='unavailable'` in the same transaction as the condition issue.
- `unsafe` site-wide creates an issue with `resource_id=NULL`; it blocks event readiness but does not mutate every resource.

- [ ] **Step 1: Write generator/validation tests**

Cover site items, tag-specific items, snapshot behavior, missing notes, full completion, cross-leg rejection, and idempotent run/result mutation ids.

- [ ] **Step 2: Write condition tests**

Assert needs-work leaves `available` unchanged; unsafe resource changes it to `unavailable`; retry does not duplicate the issue.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts
```

- [ ] **Step 4: Implement repositories/services transactionally**

Checklist result persistence must succeed even if a later attachment upload fails. If condition-issue creation fails, return the saved checklist result with `followUpSyncState='needs_attention'` rather than deleting the result.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/leg-manager/event-checklist-types.ts artifacts/api-server/src/features/leg-manager/event-checklist-repository.ts artifacts/api-server/src/features/leg-manager/event-checklist-service.ts artifacts/api-server/src/features/leg-manager/resource-condition-service.ts artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts
git commit -m "feat: add event checklist workflow service"
```

---

### Task 5: Integrate checklist state into manager check-in and two-stage checkout APIs

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager-event-lifecycle.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-event-checklists.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts`
- Test: `artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts`

**Routes:**

```text
POST /manager/events/:bookingId/check-in
  -> persist arrival first
  -> ensure/resume pre_event run
  -> response { lifecycle, nextAction: "pre_event_checklist", checklistId }

GET  /manager/events/:bookingId/checklists/:phase
POST /manager/events/:bookingId/checklists/:phase/start
PATCH /manager/events/:bookingId/checklist-results/:resultId
POST /manager/events/:bookingId/checklists/:phase/complete
POST /manager/events/:bookingId/checklists/:phase/unable-to-complete

POST /manager/events/:bookingId/checkout/start
  -> requires checked-in event
  -> ensure/resume post_event run
  -> response { checklistId }

POST /manager/events/:bookingId/check-out
  -> requires completed post_event OR unable_to_complete with reason
  -> persists departure/location + wrapUpStatus=incomplete
```

Add derived lifecycle projection:

```ts
type ManagerEventLifecycleView = {
  bookingId: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  wrapUpStatus: "not_started" | "incomplete" | "finished";
  preEventChecklistState: "not_started" | "in_progress" | "completed" | "unable_to_complete";
  postEventChecklistState: "not_started" | "in_progress" | "completed" | "unable_to_complete";
  readyToOperate: boolean;
  hasSiteWideUnsafeIssue: boolean;
};
```

- [ ] **Step 1: Write lifecycle tests for arrival-first behavior**

Simulate a checklist creation failure after successful `checkIn`; the lifecycle row must still contain `checkedInAt`. Retrying check-in must return the same arrival rather than overwrite it.

- [ ] **Step 2: Write checkout gating tests**

Direct `/check-out` before post checklist completion returns 409. Completed post checklist permits checkout. `unable_to_complete` without a reason returns 400; with a reason permits checkout and preserves the exception for admin visibility.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts
```

- [ ] **Step 4: Implement routes and derived projection**

Keep GPS optional exactly as today. Do not require location permission for either phase.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts
pnpm run typecheck
git add artifacts/api-server/src/routes/leg-manager-event-lifecycle.ts artifacts/api-server/src/features/leg-manager/event-lifecycle-repository.ts artifacts/api-server/src/routes/leg-manager-event-checklists.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts
git commit -m "feat: gate event lifecycle with safety checklists"
```

---

### Task 6: Add checklist photo upload using the existing offline blob queue pattern

**Files:**
- Create: `artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/components/manager/checklist-photo-capture.tsx`
- Reuse: `artifacts/adventure-zone/src/lib/manager-sync-queue.ts`
- Reuse: `artifacts/adventure-zone/src/lib/manager-blob-queue.ts`
- Reuse: `artifacts/adventure-zone/src/components/manager/manager-sync-status.tsx`
- Test: `artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.test.ts`
- Test: `artifacts/adventure-zone/src/components/manager/checklist-photo-capture.test.tsx`

**Mutation/blob contract:**

```ts
await queueManagerMutation({
  id,
  legId: manager.legId,
  method: "POST",
  path: `/manager/events/${bookingId}/checklist-results/${resultId}/attachments`,
  body: { id, clientMutationId: id, mimeType },
  createdAt: new Date().toISOString(),
});

await queueManagerBlob({
  id,
  legId: manager.legId,
  receiptId: id,
  kind: "checklist_attachment",
  blob: file,
  createdAt: new Date().toISOString(),
});
```

If `manager-blob-queue` currently types `kind` too narrowly, extend it to the union `"receipt" | "checklist_attachment"` and rename the generic identifier field only if that can be done without breaking receipt compatibility. Otherwise keep the compatibility field and document its generic use.

- [ ] **Step 1: Write API authorization/idempotency tests**

A manager can upload only to a result belonging to their leg. Repeating the same attachment mutation id returns the existing attachment.

- [ ] **Step 2: Write offline component tests**

Selecting a photo queues mutation metadata and blob before attempting network sync; an upload failure leaves the checklist result intact and shows Needs attention.

- [ ] **Step 3: Implement raw image PUT endpoint**

Use the same storage mechanism used by receipt images. Do not add a second cloud-storage provider path.

- [ ] **Step 4: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/manager/checklist-photo-capture.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/components/manager/checklist-photo-capture.tsx artifacts/adventure-zone/src/lib/manager-blob-queue.ts artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.test.ts artifacts/adventure-zone/src/components/manager/checklist-photo-capture.test.tsx
git commit -m "feat: add offline checklist photos"
```

---

### Task 7: Build the mobile Leg Manager checklist screens and update lifecycle actions

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerEventChecklistPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-checklist-form.tsx`
- Create: `artifacts/adventure-zone/src/features/manager/event-checklist-client.ts`
- Modify: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerHomePage.tsx`
- Test: `artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx`
- Test: `artifacts/adventure-zone/src/components/manager/event-checklist-form.test.tsx`
- Test: `artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx`

**Routes/UI:**

```text
/manager/events/:bookingId/checklist/pre-event
/manager/events/:bookingId/checklist/post-event
```

**Lifecycle action behavior:**

```text
not checked in                  -> Check in
checked in + pre incomplete     -> Finish pre-event checklist
pre complete, not checkout      -> Start checkout
post in progress                -> Finish post-event checklist
post complete                   -> Complete checkout
checked out + wrap-up incomplete-> Finish event wrap-up
finished                        -> Event wrap-up finished
```

- [ ] **Step 1: Write UI state tests**

Assert the button labels above, check-in navigates to pre-event checklist after arrival saves, Start checkout navigates to post-event checklist without recording departure, and final checkout navigates to wrap-up.

- [ ] **Step 2: Write checklist form tests**

Each item presents four large choices: Acceptable, Needs work but safe, Unsafe — cannot operate, Not applicable. Selecting needs-work/unsafe reveals a required note. Photos can be added from the item card. Resource name is shown above resource-specific items.

- [ ] **Step 3: Implement incremental autosave/offline queueing**

On each result selection/note blur, queue a manager mutation with a client UUID. Show `Saved on device`, `Syncing`, `Synced`, or `Needs attention` using the existing manager sync status component.

- [ ] **Step 4: Add completion/exception actions**

Pre-event screen: `Mark checklist complete`. Post-event screen: `Complete checklist` plus a secondary `Unable to complete` action that opens a required-reason confirmation.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx artifacts/adventure-zone/src/components/manager/event-checklist-form.test.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx
pnpm run typecheck
git add artifacts/adventure-zone/src/pages/ManagerEventChecklistPage.tsx artifacts/adventure-zone/src/components/manager/event-checklist-form.tsx artifacts/adventure-zone/src/features/manager/event-checklist-client.ts artifacts/adventure-zone/src/components/manager/event-lifecycle-action.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.tsx artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx artifacts/adventure-zone/src/components/manager/event-checklist-form.test.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx
git commit -m "feat: add manager event checklist screens"
```

---

### Task 8: Add owner/admin checklist oversight and attributable overrides

**Files:**
- Modify: `artifacts/api-server/src/routes/leg-manager-event-lifecycle-admin.ts`
- Create: `artifacts/api-server/src/routes/leg-manager-event-checklists-admin.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx`
- Test: `artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts`
- Test: `artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx`

**Owner routes:**

```text
GET  /manager-admin/events/checklists?bookingId=&legId=&state=
GET  /manager-admin/events/checklists/:runId
POST /manager-admin/events/checklists/:runId/override {
  action: "allow_ready_to_operate" | "allow_checkout",
  reason: string
}
GET  /manager-admin/resource-condition-issues?state=open
POST /manager-admin/resource-condition-issues/:issueId/resolve { reason: string }
```

Store override actor + reason in normal audit history and do not delete the original unsafe result/exception.

- [ ] **Step 1: Write owner authorization/override tests**

Manager token cannot call admin routes. Owner override requires nonblank reason. Original result remains unchanged after override.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts
```

- [ ] **Step 3: Add admin UI sections**

Show Pre-event/Post-event status, exceptions, unsafe issues, photos, and open condition issues. Keep this in existing event aftermath/operations views rather than creating a separate safety dashboard.

- [ ] **Step 4: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/leg-manager-event-lifecycle-admin.ts artifacts/api-server/src/routes/leg-manager-event-checklists-admin.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.tsx artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx
git commit -m "feat: add checklist admin oversight"
```

---

### Task 9: Full Phase 2 regression and offline lifecycle verification

**Files:**
- Modify only files required by failures found here.

- [ ] **Step 1: Run API checklist/lifecycle/resource suites**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/leg-manager/event-checklist-schema.test.ts \
  artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts \
  artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts \
  artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts \
  artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts \
  artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts \
  artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.test.ts \
  artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts
```

- [ ] **Step 2: Run manager UI suites**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx \
  artifacts/adventure-zone/src/components/manager/event-checklist-form.test.tsx \
  artifacts/adventure-zone/src/components/manager/checklist-photo-capture.test.tsx \
  artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx \
  artifacts/adventure-zone/src/pages/ManagerAftermathAdminPage.test.tsx
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 4: Manually verify the exact state chain in browser tests or local app**

```text
Confirmed event -> Check in -> arrival saved -> pre checklist -> Ready to operate
-> Start checkout -> post checklist -> final checkout -> existing wrap-up
```

Also verify browser offline mode between result selections and reconnect; queued mutations must sync once and photos must not duplicate.

- [ ] **Step 5: Commit regression fixes if any**

```bash
git status --short
# If fixes were needed:
git add <changed-files>
git commit -m "test: verify event checklist lifecycle"
```
