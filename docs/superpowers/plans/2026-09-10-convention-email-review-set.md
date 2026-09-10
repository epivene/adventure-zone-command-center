# Convention Email Review Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the exact seven current convention campaign emails into one Dave work request with immutable desktop/mobile previews, safe link testing, and independent decisions.

**Architecture:** Extend the existing `email_template_approval` work request from one review row to an ordered collection. The server owns set membership, ordering, fingerprints, link extraction, deduplication, and aggregate state; the browser renders immutable snapshots and submits link confirmations for one review item at a time.

**Tech Stack:** TypeScript, React, Express, Drizzle ORM, PostgreSQL/PGlite, Zod, parse5, Vitest, Testing Library, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-09-10-convention-email-review-set-design.md`

## Global Constraints

- The batch contains exactly the seven server-defined convention campaign templates in canonical order.
- Design Studio is not a dependency of this release.
- Each review row is an immutable snapshot of the exact subject, body, format, name, position, version, and fingerprint Dave reviews.
- The preview iframe remains sandboxed and cannot run scripts, submit forms, or navigate the parent.
- Only server-extracted HTTP(S) links from the immutable snapshot may be confirmed.
- Approval requires every safe link confirmed and no blocked link.
- Requesting changes requires a note and does not require completed link confirmations.
- Each email receives an independent final decision.
- Approved sibling emails remain approved and active when another email needs changes.
- Existing single-template review requests remain compatible.
- Creating the work request and all seven review rows is atomic and deduplicated.
- This flow never sends email or creates Gmail drafts.

---

### Task 1: Persist ordered review items and link evidence

**Files:**
- Create: `lib/db/migrations/20260910_convention_email_review_set.sql`
- Modify: `lib/db/src/boss-work-request-schema.ts`
- Create: `lib/db/src/boss-work-request-schema.test.ts`

**Interfaces:**
- Produces: `CommunicationTemplateVerifiedLink`
- Produces: review columns `position`, `templateNameSnapshot`, and `verifiedLinks`
- Consumes: existing `communicationTemplateReviews` and `communicationTemplates`

- [ ] **Step 1: Write the failing schema test**

Add assertions that the Drizzle table exposes the new fields:

```ts
import { describe, expect, it } from "vitest";
import { communicationTemplateReviews } from "./boss-work-request-schema";

describe("communication template review set schema", () => {
  it("stores item order, immutable name, and verified link evidence", () => {
    expect(Object.keys(communicationTemplateReviews)).toEqual(expect.arrayContaining([
      "position",
      "templateNameSnapshot",
      "verifiedLinks",
    ]));
  });
});
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
pnpm --filter @workspace/db exec vitest run src/boss-work-request-schema.test.ts
```

Expected: FAIL because the three properties do not exist.

- [ ] **Step 3: Add the schema types and columns**

Add:

```ts
export type CommunicationTemplateVerifiedLink = {
  href: string;
  label: string;
  verifiedAt: string;
};
```

Add to `communicationTemplateReviews`:

```ts
position: integer("position").default(0).notNull(),
templateNameSnapshot: text("template_name_snapshot").notNull(),
verifiedLinks: jsonb("verified_links")
  .$type<CommunicationTemplateVerifiedLink[]>()
  .default([])
  .notNull(),
```

Replace the request-only unique index with:

```ts
uniqueIndex("communication_template_reviews_request_template_unique")
  .on(table.requestId, table.templateId),
uniqueIndex("communication_template_reviews_request_position_unique")
  .on(table.requestId, table.position),
index("communication_template_reviews_request_decision_idx")
  .on(table.requestId, table.decision),
check("communication_template_reviews_position_nonnegative", sql`${table.position} >= 0`),
```

- [ ] **Step 4: Write the idempotent SQL migration**

The migration must:

1. add nullable `position`, `template_name_snapshot`, and `verified_links`;
2. backfill names from `communication_templates`;
3. backfill position zero for existing single-item requests;
4. make all three columns non-null and set defaults for position/verified links;
5. drop `communication_template_reviews_request_unique`;
6. create the two unique indexes, decision index, and non-negative check.

Use this backfill:

```sql
UPDATE communication_template_reviews r
SET template_name_snapshot = t.name
FROM communication_templates t
WHERE t.id = r.template_id
  AND r.template_name_snapshot IS NULL;

UPDATE communication_template_reviews
SET position = 0
WHERE position IS NULL;

UPDATE communication_template_reviews
SET verified_links = '[]'::jsonb
WHERE verified_links IS NULL;
```

Each DDL statement uses `IF EXISTS` or `IF NOT EXISTS` where PostgreSQL permits it. Guard the check constraint with a `pg_constraint` lookup.

- [ ] **Step 5: Run schema verification and typecheck**

Run:

```bash
pnpm --filter @workspace/db exec vitest run src/boss-work-request-schema.test.ts
pnpm --filter @workspace/db typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/20260910_convention_email_review_set.sql lib/db/src/boss-work-request-schema.ts lib/db/src/boss-work-request-schema.test.ts
git commit -m "feat: persist convention email review items"
```

### Task 2: Extract and validate exact snapshot links

**Files:**
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/api-server/src/features/boss-work-requests/template-review-links.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/template-review-links.test.ts`

**Interfaces:**
- Produces: `extractTemplateReviewLinks(html: string): TemplateReviewLinkInventory`
- Produces: `validateVerifiedLinks(inventory, submitted, now): CommunicationTemplateVerifiedLink[]`
- Consumes: `CommunicationTemplateVerifiedLink` from `@workspace/db/boss-work-request-schema`

Define:

```ts
export type TemplateReviewLink = {
  href: string;
  label: string;
};

export type BlockedTemplateReviewLink = {
  rawHref: string;
  label: string;
  reason: "unsupported_protocol" | "unresolved_placeholder" | "invalid_url";
};

export type TemplateReviewLinkInventory = {
  safe: TemplateReviewLink[];
  blocked: BlockedTemplateReviewLink[];
};
```

- [ ] **Step 1: Add failing link extraction tests**

Cover anchor text, linked-image alt fallback, host fallback, duplicate destinations, unresolved placeholders, malformed values, and `javascript:`/`data:` blocking.

```ts
it("extracts unique HTTP links with readable labels", () => {
  expect(extractTemplateReviewLinks(
    '<a href="https://example.com/learn"><img alt="See attractions"></a>'
    + '<a href="https://example.com/learn">Duplicate</a>',
  )).toEqual({
    safe: [{ href: "https://example.com/learn", label: "See attractions" }],
    blocked: [],
  });
});

it("blocks unsafe and unresolved destinations", () => {
  const result = extractTemplateReviewLinks(
    '<a href="javascript:alert(1)">Bad</a><a href="{{websiteUrl}}">Later</a>',
  );
  expect(result.safe).toEqual([]);
  expect(result.blocked.map((item) => item.reason)).toEqual([
    "unsupported_protocol",
    "unresolved_placeholder",
  ]);
});
```

Also test that `validateVerifiedLinks` rejects a submitted URL not in `inventory.safe`, rejects incomplete confirmation, and returns timestamped evidence only for the exact complete safe set.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/template-review-links.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add parse5 as a direct API dependency**

Run:

```bash
pnpm --filter @workspace/api-server add parse5
```

Use parse5's fragment parser and tree traversal; do not parse links with a regular expression. Build labels from descendant text, then linked image `alt`, then `new URL(href).hostname`. Deduplicate by normalized absolute URL while preserving first appearance order.

- [ ] **Step 4: Implement strict verification**

`validateVerifiedLinks` accepts an array of submitted exact href strings. It throws these stable errors:

```ts
export const LINK_REVIEW_ERRORS = {
  blocked: "BLOCKED_TEMPLATE_LINK",
  incomplete: "INCOMPLETE_TEMPLATE_LINK_REVIEW",
  unknown: "UNKNOWN_TEMPLATE_LINK",
} as const;
```

Approval validation fails if `inventory.blocked.length > 0`, if submitted values contain duplicates/unknown values, or if the set differs from `inventory.safe.map(link => link.href)`.

- [ ] **Step 5: Run tests and API typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/template-review-links.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/src/features/boss-work-requests/template-review-links.ts artifacts/api-server/src/features/boss-work-requests/template-review-links.test.ts
git commit -m "feat: validate email review links"
```

### Task 3: Create one atomic seven-template review set

**Files:**
- Create: `artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts`
- Create: `artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.pglite.test.ts`

**Interfaces:**
- Produces: `CONVENTION_REVIEW_TEMPLATE_CODES: readonly string[]`
- Produces: `BossWorkRequestService.createConventionEmailReviewSet(input): Promise<{ detail: BossWorkRequestDetail; created: boolean }>`
- Produces: `BossWorkRequestRepository.createTemplateReviewSet(input)`
- Consumes: `templateFingerprint` and the schema from Task 1

- [ ] **Step 1: Write the failing PGlite creation tests**

Create a focused PGlite setup with the five required tables: `boss_accounts`, `communication_templates`, `boss_work_requests`, `boss_work_request_events`, and `communication_template_reviews`, including the referenced fields and constraints.

Seed the exact seven codes exported by `CONVENTION_REVIEW_TEMPLATE_CODES`. Assert:

```ts
const first = await service.createConventionEmailReviewSet(input);
const second = await service.createConventionEmailReviewSet(input);

expect(first.templateReviews).toHaveLength(7);
expect(first.templateReviews.map((item) => item.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
expect(first.templateReviews.map((item) => item.templateNameSnapshot))
  .toEqual(["Template 1", "Template 2", "Template 3", "Template 4", "Template 5", "Template 6", "Template 7"]);
expect(second.request.id).toBe(first.request.id);
expect((await db.select().from(bossWorkRequests))).toHaveLength(1);
```

Add a second test that removes one expected template and asserts no request/review row is created.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/convention-email-review-set.pglite.test.ts
```

Expected: FAIL because the set creator does not exist.

- [ ] **Step 3: Define the canonical set**

`CONVENTION_REVIEW_TEMPLATE_CODES` must be an explicit seven-entry tuple matching the source definitions in `convention-campaign-template-seed.ts`; do not discover templates with a broad category query.

Add:

```ts
export function conventionReviewSetFingerprint(
  items: readonly { templateId: string; fingerprint: string }[],
) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}
```

- [ ] **Step 4: Implement atomic repository creation**

`createTemplateReviewSet` receives the request values and seven snapshot values. Open one database transaction, insert the deduplicated request, resolve the existing request on conflict, and insert all seven review rows only when the request was newly created. Return `{ detail, created }`, where `created` is false when the deduplication key resolved an existing request.

No service call may create the request first and insert reviews afterward.

- [ ] **Step 5: Implement service validation**

`createConventionEmailReviewSet` loads by `inArray(communicationTemplates.code, CONVENTION_REVIEW_TEMPLATE_CODES)`, reconstructs canonical order, and rejects:

- count other than seven;
- missing/duplicate code;
- non-company ownership;
- archived state;
- invalid authored template text.

Build each snapshot with `position`, `templateNameSnapshot`, and empty `verifiedLinks`. Active templates are accepted without state changes.

- [ ] **Step 6: Run creation tests and relevant regression tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/convention-email-review-set.pglite.test.ts src/features/boss-work-requests/boss-work-request-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.pglite.test.ts
git commit -m "feat: create atomic convention email review set"
```

### Task 4: Decide individual items and calculate aggregate state

**Files:**
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts`
- Modify: `artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.pglite.test.ts`

**Interfaces:**
- Produces: `decideTemplateReview(input: { requestId; reviewId; bossAccountId; decision; note; verifiedLinks })`
- Consumes: `extractTemplateReviewLinks` and `validateVerifiedLinks` from Task 2
- Consumes: ordered `templateReviews` detail from Task 3

- [ ] **Step 1: Add failing aggregate-decision tests**

Test these sequences:

```ts
await decide(0, "approved", allLinksFor(0));
expect((await detail()).request.state).toBe("in_progress");

for (const position of [1, 2, 3, 4, 5, 6]) {
  await decide(position, "approved", allLinksFor(position));
}
expect((await detail()).request.state).toBe("approved");
expect((await detail()).request.completedAt).not.toBeNull();
```

In a separate case, approve six and request changes on one with a note. Assert request state `changes_requested`, only six templates are active from this decision series, and every item retains its own decision/note.

Add cases for changed source content, incomplete/unknown link evidence, repeated identical decisions, and conflicting repeated decisions.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/convention-email-review-set.pglite.test.ts
```

Expected: FAIL because decisions still target the single request review.

- [ ] **Step 3: Return ordered review collections**

Change both owner and Boss detail loads from `.limit(1)` to `.orderBy(asc(communicationTemplateReviews.position))`. In the service detail methods, map each snapshot through `extractTemplateReviewLinks` so both owner and Boss responses receive authoritative `links` and `blockedLinks`. Return:

```ts
{
  request,
  templateReviews,
  templateReview: templateReviews.length === 1 ? templateReviews[0] : null,
  events,
  // existing convention fields remain unchanged
}
```

- [ ] **Step 4: Implement item-specific decision transaction**

Lock/select the assigned request and requested review. Validate request ownership, item pending state, fingerprint, note rules, and verified links before writing.

After updating one review, query all request decisions and compute:

```ts
const hasPending = decisions.some((value) => value === "pending");
const hasChanges = decisions.some((value) => value === "changes_requested");
const nextState = hasPending ? "in_progress" : hasChanges ? "changes_requested" : "approved";
```

Set `completedAt` only for `approved`. Activate only the approved item's exact current template content. Add one work-request event containing `reviewId`, `templateId`, and `position` metadata.

- [ ] **Step 5: Preserve the legacy one-item service method**

`decideTemplate` resolves `detail.templateReview` and delegates to `decideTemplateReview`. If `templateReviews.length !== 1`, throw `BossWorkRequestConflictError("Choose a specific email review item.")`.

- [ ] **Step 6: Run decision tests and API typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/boss-work-requests/convention-email-review-set.pglite.test.ts src/features/boss-work-requests/boss-work-request-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/boss-work-requests/boss-work-request-service.ts artifacts/api-server/src/features/boss-work-requests/boss-work-request-repository.ts artifacts/api-server/src/features/boss-work-requests/convention-email-review-set.pglite.test.ts
git commit -m "feat: decide convention email reviews independently"
```

### Task 5: Expose owner creation and Boss item-decision routes

**Files:**
- Modify: `artifacts/api-server/src/routes/communication-templates.ts`
- Modify: `artifacts/api-server/src/routes/communication-templates.test.ts`
- Modify: `artifacts/api-server/src/routes/boss-work-requests.ts`
- Modify: `artifacts/api-server/src/routes/boss-work-requests.test.ts`

**Interfaces:**
- Produces: `POST /communication-templates/convention-review-set`
- Produces: `POST /boss/work-requests/:requestId/template-reviews/:reviewId/decision`
- Consumes: service methods from Tasks 3 and 4

- [ ] **Step 1: Add failing route boundary tests**

Assert the owner route uses `createConventionEmailReviewSet`, and the Boss route includes `requireBoss`, `reviewId`, and `verifiedLinks`.

Add the Zod shape:

```ts
const templateReviewDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  note: z.string().trim().max(12000).nullable().optional(),
  verifiedLinks: z.array(z.string().url()).max(40).default([]),
}).strict();
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.test.ts src/routes/boss-work-requests.test.ts
```

Expected: FAIL because neither new route exists.

- [ ] **Step 3: Implement the owner route**

Reuse the existing assignment/priority/due-date schema. Call `createConventionEmailReviewSet` and return HTTP 201 for a newly created request or HTTP 200 for the deduplicated existing request. Return HTTP 409 with the service error for an incomplete/invalid set.

- [ ] **Step 4: Implement the Boss decision route**

Validate both UUID params. Pass the authenticated `req.bossAccount!.accountId`; never accept a Boss account ID from the body. Map not-found to 404, validation to 400, and changed/concurrent/link conflicts to 409.

Keep `/template-decision` as the one-item compatibility route.

- [ ] **Step 5: Run route tests and API build checks**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.test.ts src/routes/boss-work-requests.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/communication-templates.ts artifacts/api-server/src/routes/communication-templates.test.ts artifacts/api-server/src/routes/boss-work-requests.ts artifacts/api-server/src/routes/boss-work-requests.test.ts
git commit -m "feat: expose convention email review set routes"
```

### Task 6: Share preview samples and extend frontend contracts

**Files:**
- Create: `artifacts/adventure-zone/src/lib/communication-template-preview.ts`
- Create: `artifacts/adventure-zone/src/lib/communication-template-preview.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-types.ts`
- Modify: `artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-api.ts`

**Interfaces:**
- Produces: `renderTemplatePreviewExample(value: string): string`
- Produces: `createConventionEmailReviewSet(input)`
- Produces: `decideEmailTemplateReview(requestId, reviewId, decision, note, verifiedLinks)`
- Produces: frontend `TemplateReviewLink` and extended `TemplateReview`
- Consumes: current sample placeholder behavior from the Settings page

- [ ] **Step 1: Write failing preview-helper tests**

Move the exact sample map currently embedded in `SettingsCommunicationTemplatesPage.tsx` into the new helper. Assert:

```ts
expect(renderTemplatePreviewExample(
  "Hi {{contactName}} — {{conventionName}} — {{earlyBirdDeadline}}",
)).toBe("Hi Jamie — Example Convention — December 31, 2026");
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/lib/communication-template-preview.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Extract the helper without changing Settings behavior**

Export the sample value map and renderer, import it in `SettingsCommunicationTemplatesPage.tsx`, and rerun its existing live-preview test.

- [ ] **Step 4: Extend types and API calls**

`TemplateReview` gains `position`, `templateNameSnapshot`, `verifiedLinks: { href: string; label: string; verifiedAt: string }[]`, `links: { href: string; label: string }[]`, and `blockedLinks: { rawHref: string; label: string; reason: string }[]`. `BossWorkRequestDetail` gains `templateReviews: TemplateReview[]`.

Add:

```ts
export const decideEmailTemplateReview = (
  requestId: string,
  reviewId: string,
  decision: "approved" | "changes_requested",
  note: string | null,
  verifiedLinks: string[],
) => bossPost(
  `/boss/work-requests/${requestId}/template-reviews/${reviewId}/decision`,
  { decision, note, verifiedLinks },
);
```

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/lib/communication-template-preview.test.ts src/pages/SettingsCommunicationTemplatesPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/lib/communication-template-preview.ts artifacts/adventure-zone/src/lib/communication-template-preview.test.ts artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-types.ts artifacts/adventure-zone/src/features/boss-work-requests/boss-work-request-api.ts
git commit -m "refactor: share email review preview contracts"
```

### Task 7: Add the owner send-set action

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx`

**Interfaces:**
- Produces: owner-facing **Send convention set to Dave** action
- Consumes: `POST /communication-templates/convention-review-set`
- Consumes: existing `/boss-admin/accounts` Dave-account selection

- [ ] **Step 1: Write the failing owner UI test**

Mock the template list, Dave accounts, and set creation. Click the action and assert one call:

```ts
expect(apiFetch).toHaveBeenCalledWith(
  "/communication-templates/convention-review-set",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify(expect.objectContaining({
      assignedBossAccountId: DAVE_ACCOUNT_ID,
      priority: "high",
    })),
  }),
);
expect(await screen.findByText("Seven convention emails were sent to Dave in one review set."))
  .toBeInTheDocument();
```

Also assert the button disables while working and that a deduplicated HTTP 200 response uses the message **This exact review set is already waiting for Dave.**

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/pages/SettingsCommunicationTemplatesPage.test.tsx
```

Expected: FAIL because the set action is absent.

- [ ] **Step 3: Implement the action**

Place a highlighted review card above the grouped template list with:

- title **Convention email review**;
- helper copy **Send all seven current convention emails as one task.**;
- **Send convention set to Dave** button;
- busy/error/status feedback.

Resolve Dave exactly as the existing single-template flow does. Use priority `high` for today's review action. Do not loop over the single-template endpoint.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/pages/SettingsCommunicationTemplatesPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx
git commit -m "feat: send convention emails as one review set"
```

### Task 8: Build Dave's seven-email review workspace

**Files:**
- Create: `artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx`

**Interfaces:**
- Produces: ordered review navigation, progress, previews, link checklist, and per-item decisions
- Consumes: `detail.templateReviews`, `renderTemplatePreviewExample`, and `decideEmailTemplateReview`

- [ ] **Step 1: Write the failing rendering/navigation test**

Create a detail fixture with seven ordered reviews. Assert:

- **0 of 7 reviewed**;
- **Email 1 of 7** opens initially;
- clicking email 3 shows its immutable subject/body;
- desktop/mobile controls resize the preview shell;
- sample placeholders appear in the preview, while fixture snapshots remain unchanged.

- [ ] **Step 2: Write the failing link and decision test**

For an item with two safe links, assert:

```ts
expect(screen.getByRole("button", { name: "Approve email" })).toBeDisabled();
expect(screen.getByText("https://www.the-adventure-zone.com/")).toBeInTheDocument();

fireEvent.click(screen.getByRole("link", { name: /Test link: Visit website/ }));
expect(screen.getByRole("link", { name: /Test link: Visit website/ })).toHaveAttribute(
  "target", "_blank",
);
expect(screen.getByRole("link", { name: /Test link: Visit website/ })).toHaveAttribute(
  "rel", expect.stringContaining("noopener"),
);
fireEvent.click(screen.getByLabelText("Link works: Visit website"));
```

Confirm approval remains disabled until both links are checked, then submits exact hrefs. Confirm **Request changes** requires a note but not link checks.

Add a blocked-link fixture and assert approval remains disabled with a visible warning.

- [ ] **Step 3: Run and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/EmailTemplateReview.test.tsx
```

Expected: FAIL because the current component reads only `detail.templateReview`.

- [ ] **Step 4: Split focused UI units inside the component file**

Implement these exact component boundaries:

```ts
type ReviewProgressProps = {
  reviews: TemplateReview[];
  selectedId: string;
  onSelect(reviewId: string): void;
};
type ReviewPreviewProps = {
  review: TemplateReview;
  device: "desktop" | "mobile";
};
type LinkChecklistProps = {
  links: TemplateReview["links"];
  blockedLinks: TemplateReview["blockedLinks"];
  checked: string[];
  onCheckedChange(href: string, checked: boolean): void;
};
type ItemDecisionProps = {
  requestId: string;
  review: TemplateReview;
  checkedLinks: string[];
  reload(): Promise<void>;
};
```

`ReviewProgress` owns navigation markup only; `ReviewPreview` owns the subject and sandboxed iframe; `LinkChecklist` owns external anchors and confirmations; `ItemDecision` owns note validation and the decision request.
Keep state keyed by `review.id`:

```ts
const [selectedId, setSelectedId] = useState(firstPending?.id ?? reviews[0]?.id ?? "");
const [notes, setNotes] = useState<Record<string, string>>({});
const [checkedLinks, setCheckedLinks] = useState<Record<string, string[]>>({});
```

Do not use array position as a React key.

- [ ] **Step 5: Render safe previews and exact test links**

Use a sandboxed iframe with preview-only sample replacement. Desktop uses a `640px` max-width shell; mobile uses a `360px` max-width shell. The external test action is an `<a>` with `target="_blank"` and `rel="noopener noreferrer"`.

The iframe itself remains noninteractive for authoritative testing; the checklist is the only approval evidence path.

- [ ] **Step 6: Implement decisions and progress**

Disable approval unless:

```ts
const canApprove =
  review.decision === "pending"
  && review.blockedLinks.length === 0
  && review.links.every((link) => checked.includes(link.href));
```

After a successful decision, reload detail and select the next pending review. Decided items remain readable and their actions are disabled.

- [ ] **Step 7: Run focused UI tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts src/components/boss-work-requests/EmailTemplateReview.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.test.tsx
git commit -m "feat: add Dave convention email review workspace"
```

### Task 9: Verify compatibility and release readiness

**Files:**
- Modify only files required by failures found in this verification task.

**Interfaces:**
- Consumes: all prior task outputs
- Produces: a verified review-first release with no known regression in one-template review behavior

- [ ] **Step 1: Run the complete focused API suite**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/boss-work-requests/template-review-links.test.ts   src/features/boss-work-requests/convention-email-review-set.pglite.test.ts   src/features/boss-work-requests/boss-work-request-service.test.ts   src/routes/communication-templates.test.ts   src/routes/boss-work-requests.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run the complete focused frontend suite**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run --config vitest.config.ts   src/lib/communication-template-preview.test.ts   src/pages/SettingsCommunicationTemplatesPage.test.tsx   src/components/boss-work-requests/EmailTemplateReview.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run typechecks and builds**

```bash
pnpm --filter @workspace/db typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: every command exits zero.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check main...HEAD
git status --short
rg -n "T[B]D|T[O]DO|F[I]XME|l[o]rem|javascript:|data:"   lib/db/src/boss-work-request-schema.ts   lib/db/migrations/20260910_convention_email_review_set.sql   artifacts/api-server/src/features/boss-work-requests   artifacts/api-server/src/routes/communication-templates.ts   artifacts/api-server/src/routes/boss-work-requests.ts   artifacts/adventure-zone/src/components/boss-work-requests/EmailTemplateReview.tsx   artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx
```

Expected: `git diff --check` is clean; `git status --short` shows only intentional work; placeholder scan has no unfinished implementation markers. Test fixtures may contain `javascript:` and `data:` only in the link-blocking tests.

- [ ] **Step 5: Manually verify the intended workflow against a local server**

Using owner access:

1. Open `/settings/communication-templates`.
2. Confirm all seven current emails render.
3. Select **Send convention set to Dave** once and confirm one request.
4. Select it again and confirm no duplicate request.

Using Dave access:

1. Open the single **Review convention email set** task.
2. Confirm all seven names and order.
3. Toggle one preview between desktop and mobile.
4. Open every test link for one email and mark each working.
5. Approve that email and confirm progress becomes **1 of 7 reviewed**.
6. Request changes on a different email with a note.
7. Finish the other five decisions.
8. Confirm the parent finishes as **changes requested**, the six approved templates remain active, and the owner sees the exact changed item and note.

- [ ] **Step 6: Commit any verification-only correction, otherwise record no extra commit**

If verification required a correction, rerun the failed command and then the full commands in Steps 1–3 before committing:

```bash
git add --update
git commit -m "fix: complete convention email review verification"
```

If no correction was required, do not create an empty commit.
