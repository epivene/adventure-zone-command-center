# Early Bird Promo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tracked 10% Early Bird Promo to eligible sales and convention emails, preserve one 30-day deadline per event, and prepare a reviewable reminder after 15 days when an interested customer has not paid a deposit.

**Architecture:** Add a durable event/year promotion-enrollment table linked to the existing commercial-offer rule, opportunity/email records, and optional booking. A shared pure policy module determines campaign eligibility, calendar dates, and plain-text/HTML copy; both the Office/Boss and Opportunity Gmail send paths finalize the date immediately before delivery and then idempotently record the confirmed send. A background worker turns due, interested enrollments into an organization-level follow-up plus a submitted Office email draft, which makes the reminder appear in the existing Today and Boss review queues without automatic sending.

**Tech Stack:** TypeScript, PostgreSQL, Drizzle ORM, Express 5, React 19, Vitest 4, PGlite, Gmail draft/delivery APIs, existing Office SMTP delivery.

**Spec:** `docs/superpowers/specs/2026-09-09-early-bird-promo-design.md`

## Global Constraints

- Campaign name is exactly `Early Bird Promo`.
- Customer copy says: `For a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by {{offerDeadline}}.`
- Customer-facing copy never says `30 days`; the application still calculates the deadline as 30 calendar days after the first confirmed qualifying send.
- The first qualifying sent email starts the window; drafts, previews, approvals, failed sends, and scheduled-but-unsent messages do not.
- Later qualifying emails reuse the original saved deadline and never extend it.
- New enrollments may start through March 31, 2027; a March 31 send retains its complete 30-day window.
- Apply the promotion once to sales/outreach templates, including every current pre-, during-, and post-convention sales template; exclude operational, decline, confirmation, holiday, and post-event templates.
- Preserve the existing convention images, animation, personalization, mobile layout, footer, and signature.
- The 10% promotion never stacks automatically with the proposed 12% convention offer or another discount.
- Keep the Amy-derived `early_bird_10_percent` source rule proposed and untouched; use a separate owner-approved `early_bird_promo_2026_2027` rule for this campaign.
- Interpret campaign dates and customer deadlines in the existing `America/Chicago` business timezone. Store the customer deadline as an inclusive calendar date and expire at the following business-day boundary.
- A reminder becomes due 15 calendar days after the original qualifying send only after interest is confirmed and only while no deposit is recorded.
- Reminders are reviewable drafts; they never send automatically.
- All send callbacks, Gmail reconciliation, reply/status processing, and reminder work are idempotent.

## File Structure

- `lib/db/src/early-bird-promo-schema.ts`: promo enrollment states, columns, constraints, and indexes.
- `lib/db/migrations/20260909_early_bird_promo.sql`: additive production schema migration.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-policy.ts`: pure campaign dates, template eligibility, formatting, and copy insertion.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-offer-seed.ts`: separately approved active campaign rule, kept outside source-derived offer seeds.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-repository.ts`: transactional enrollment lifecycle and due-work claims.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-service.ts`: send, interest, deposit, expiration, cancellation, and reminder orchestration.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker.ts`: one-unit reminder/expiration processing.
- `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker-loop.ts`: bounded recurring worker lifecycle.
- `artifacts/api-server/src/routes/early-bird-promo.ts`: profile read and reviewed manual transition endpoints.
- `artifacts/adventure-zone/src/components/event-profiles/early-bird-promo-card.tsx`: profile status and action card.
- Existing communication-template, Office-email, Opportunity-email, profile, and startup files are modified only at their integration seams.

---

### Task 1: Add the durable promotion enrollment model

**Files:**
- Create: `lib/db/src/early-bird-promo-schema.ts`
- Create: `lib/db/migrations/20260909_early_bird_promo.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/drizzle-schema.ts`
- Modify: `lib/db/src/migrations.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `lib/db/src/office-coordinator-schema.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-schema.test.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-schema.pglite.test.ts`

**Interfaces:**
- Produces: `earlyBirdPromoEnrollments`, `EarlyBirdPromoStatus`, `EarlyBirdPromoSourceKind`, and `officeEmailStateValues` including `cancelled`.
- Enrollment identity: one row per `(commercialOfferRuleId, organizationId, eventYear)`.
- Reminder claims use `claimLeaseOwner` and `claimLeaseExpiresAt`; external workers never hold a database transaction while generating a Gmail/Office draft.

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import { officeEmailDrafts, earlyBirdPromoEnrollments } from "@workspace/db";

describe("Early Bird Promo schema", () => {
  it("exports durable enrollment and cancellable review-draft fields", () => {
    expect(earlyBirdPromoEnrollments.organizationId).toBeDefined();
    expect(earlyBirdPromoEnrollments.eventYear).toBeDefined();
    expect(earlyBirdPromoEnrollments.deadlineDate).toBeDefined();
    expect(earlyBirdPromoEnrollments.expiresAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.reminderDueAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.depositReceivedAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.claimLeaseExpiresAt).toBeDefined();
    expect(officeEmailDrafts.state).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo/early-bird-promo-schema.test.ts
```

Expected: FAIL because `@workspace/db` does not export `earlyBirdPromoEnrollments`.

- [ ] **Step 3: Add the Drizzle table and state types**

Create `early-bird-promo-schema.ts` with these exact exported values and columns:

```ts
export const earlyBirdPromoStatusValues = ["active", "secured", "expired", "cancelled"] as const;
export type EarlyBirdPromoStatus = (typeof earlyBirdPromoStatusValues)[number];
export const earlyBirdPromoSourceKindValues = ["office_email", "opportunity_email"] as const;
export type EarlyBirdPromoSourceKind = (typeof earlyBirdPromoSourceKindValues)[number];

export const earlyBirdPromoEnrollments = pgTable("early_bird_promo_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  commercialOfferRuleId: uuid("commercial_offer_rule_id").notNull().references(() => commercialOfferRules.id, { onDelete: "restrict" }),
  opportunityId: uuid("opportunity_id").references(() => bookingOpportunities.id, { onDelete: "set null" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  officeAccountId: uuid("office_account_id").references(() => officeAccounts.id, { onDelete: "set null" }),
  eventYear: integer("event_year").notNull(),
  sourceKind: text("source_kind").$type<EarlyBirdPromoSourceKind>().notNull(),
  firstEmailRecordId: uuid("first_email_record_id").notNull(),
  firstGmailMessageId: text("first_gmail_message_id"),
  firstGmailThreadId: text("first_gmail_thread_id"),
  firstSentAt: timestamp("first_sent_at", { withTimezone: true }).notNull(),
  deadlineDate: date("deadline_date", { mode: "string" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").$type<EarlyBirdPromoStatus>().default("active").notNull(),
  interestConfirmedAt: timestamp("interest_confirmed_at", { withTimezone: true }),
  interestEvidenceMessageId: text("interest_evidence_message_id"),
  reminderDueAt: timestamp("reminder_due_at", { withTimezone: true }),
  reminderDraftId: uuid("reminder_draft_id").references(() => officeEmailDrafts.id, { onDelete: "set null" }),
  reminderFollowUpId: uuid("reminder_follow_up_id").references(() => followUps.id, { onDelete: "set null" }),
  depositReceivedAt: timestamp("deposit_received_at", { withTimezone: true }),
  depositSource: text("deposit_source"),
  cancelReason: text("cancel_reason"),
  claimLeaseOwner: text("claim_lease_owner"),
  claimLeaseExpiresAt: timestamp("claim_lease_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("early_bird_promo_offer_org_year_unique").on(table.commercialOfferRuleId, table.organizationId, table.eventYear),
  index("early_bird_promo_due_idx").on(table.status, table.reminderDueAt),
  check("early_bird_promo_status_valid", sql`${table.status} in ('active','secured','expired','cancelled')`),
  check("early_bird_promo_source_valid", sql`${table.sourceKind} in ('office_email','opportunity_email')`),
  check("early_bird_promo_year_valid", sql`${table.eventYear} between 2000 and 2200`),
  check("early_bird_promo_window_valid", sql`${table.expiresAt} > ${table.firstSentAt}`),
]);
```

Add `cancelled` to `officeEmailStateValues` and the Drizzle check expression. Make `officeEmailDrafts.officeAccountId` nullable so system-prepared Boss drafts do not require a fake user account.
Also add these nullable columns to `officeEmailDrafts` so a reviewed draft keeps the event/year context selected when it was prepared:

```ts
bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
eventYear: integer("event_year"),
```

Add `check("office_email_drafts_event_year_valid", sql`${table.eventYear} is null or ${table.eventYear} between 2000 and 2200`)` and an index on `(organizationId, eventYear)`.

- [ ] **Step 4: Add the matching additive SQL migration and migration marker**

The migration must create the table and indexes above, including `deadline_date date NOT NULL`; add the two Office draft context columns; drop/recreate `office_email_drafts_state_valid` with `cancelled`; add the event-year check; and run:

```sql
ALTER TABLE office_email_drafts ALTER COLUMN office_account_id DROP NOT NULL;
ALTER TABLE office_email_drafts ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE office_email_drafts ADD COLUMN IF NOT EXISTS event_year integer;
```

Register `20260909_early_bird_promo.sql` in `lib/db/src/migrations.ts` with a marker that checks the table, unique index, lease columns, and nullable `office_account_id`. Export/spread the schema from all four schema barrel files listed above.

- [ ] **Step 5: Write and run a PGlite migration test**

The test creates the referenced minimal tables, executes the migration twice, inserts one valid enrollment, rejects a duplicate offer/profile/year enrollment, accepts a `cancelled` Office draft, and rejects `expires_at <= first_sent_at`.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo/early-bird-promo-schema.test.ts src/features/early-bird-promo/early-bird-promo-schema.pglite.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the schema**

```bash
git add lib/db/src/early-bird-promo-schema.ts lib/db/migrations/20260909_early_bird_promo.sql lib/db/src/index.ts lib/db/src/drizzle-schema.ts lib/db/src/migrations.ts lib/db/src/office-coordinator-schema.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/early-bird-promo/early-bird-promo-schema.test.ts artifacts/api-server/src/features/early-bird-promo/early-bird-promo-schema.pglite.test.ts
git commit -m "feat: add early bird promo enrollment schema"
```

### Task 2: Define campaign dates, eligibility, and exact copy

**Files:**
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-policy.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-offer-seed.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-policy.test.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-offer-seed.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts`
- Modify: `artifacts/api-server/src/features/commercial-offers/commercial-offer-source-safety.test.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-seed-refresh.test.ts`

**Interfaces:**
- Produces: `EARLY_BIRD_PROMO`, `earlyBirdPromoEligibility(input)`, `earlyBirdPromoDates(sentAt)`, `formatEarlyBirdPromoDeadline(deadlineDate)`, `upsertEarlyBirdPromoBlock(body, deadlineDate)`, `removeEarlyBirdPromoBlock(body)`, and `ensureEarlyBirdPromoOffer(database)`.
- `upsertEarlyBirdPromoBlock` accepts plain text or HTML, inserts exactly one block before a recognized footer/signature, and never changes unrelated rich-template markup.

- [ ] **Step 1: Write failing pure-policy tests**

Cover these exact cases:

```ts
expect(earlyBirdPromoDates(new Date("2026-10-25T06:30:00Z"))).toMatchObject({
  deadlineDate: "2026-11-24",
  reminderDate: "2026-11-09",
  expiresAt: new Date("2026-11-25T06:00:00.000Z"),
  reminderDueAt: new Date("2026-11-09T06:00:00.000Z"),
});
expect(earlyBirdPromoEligibility({ sentAt: new Date("2027-04-01T04:59:59Z"), category: "convention", code: "met_at_convention", alreadyPaid: false })).toBe(true);
expect(earlyBirdPromoEligibility({ sentAt: new Date("2027-04-01T05:00:00Z"), category: "convention", code: "met_at_convention", alreadyPaid: false })).toBe(false);
expect(earlyBirdPromoEligibility({ sentAt: new Date("2026-10-01T00:00:00Z"), category: "payment", code: "deposit_received", alreadyPaid: false })).toBe(false);
expect(upsertEarlyBirdPromoBlock("Hello\n\nThanks,\nDesiree", deadline).match(/Early Bird Promo/g)).toHaveLength(1);
expect(upsertEarlyBirdPromoBlock(upsertEarlyBirdPromoBlock(html, deadline), deadline)).toBe(upsertEarlyBirdPromoBlock(html, deadline));
expect(upsertEarlyBirdPromoBlock(html, deadline)).toContain("<!-- early-bird-promo:start -->");
expect(upsertEarlyBirdPromoBlock(html, deadline)).toContain("<!-- early-bird-promo:end -->");
```

Also assert that generated customer copy contains `Early Bird Promo`, `10%`, and the formatted date, does not contain `30 days` or `12%`, and preserves a rich convention fixture byte-for-byte outside the promo markers. Assert that `expiresAt` is the start of the business day after `deadlineDate`, making the displayed date inclusive.

- [ ] **Step 2: Run the policy test and verify it fails**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo/early-bird-promo-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the pure policy**

Use these constants and signatures:

```ts
export const EARLY_BIRD_PROMO = {
  offerCode: "early_bird_promo_2026_2027",
  name: "Early Bird Promo",
  campaignStartDate: "2026-09-09",
  lastEnrollmentDate: "2027-03-31",
  businessTimeZone: "America/Chicago",
  bookingYear: 2027,
  deadlineDays: 30,
  reminderDays: 15,
} as const;

export function earlyBirdPromoDates(sentAt: Date): { deadlineDate: string; reminderDate: string; expiresAt: Date; reminderDueAt: Date };
export function formatEarlyBirdPromoDeadline(deadlineDate: string): string;
export function earlyBirdPromoEligibility(input: { sentAt: Date; category: string | null; code: string | null; alreadyPaid: boolean }): boolean;
export function upsertEarlyBirdPromoBlock(body: string, deadline: Date): string;
export function removeEarlyBirdPromoBlock(body: string): string;
```

Eligibility includes categories `outreach`, `rebooking`, `follow_up`, `convention`, `package`, and `objection`. Explicitly deny codes `deposit_received`, `signed_contract_received`, `coi_information_request`, `insurance_liability_response`, `not_this_year_thank_you`, `thank_you_after_event`, `holiday_message`, `ride_inspector_request`, and `internal_coi_request` regardless of category. Compare campaign bounds with `businessDateKey` from `src/lib/business-date.ts`; implement a focused local-calendar helper that converts deadline/reminder date keys to `America/Chicago` boundaries, and test the March cutoff plus both DST transitions.

Plain-text insertion goes immediately before the final signature block when it begins with `Thanks`, `Thanks again`, `Best`, or the sender name; otherwise append it. HTML insertion goes before the final footer/signature container when recognized, otherwise immediately before `</body>`. Use the invisible HTML markers above and plain-text markers `Early Bird Promo:` and the following promotion sentence for replacement/deduplication.

- [ ] **Step 4: Seed a separate owner-approved campaign rule**

Leave `COMMERCIAL_OFFER_SEEDS` and its `early_bird_10_percent` entry unchanged. Add `ensureEarlyBirdPromoOffer(database)`, which inserts this separate rule with `sourceDocumentId: null` and `reviewedAt` set to the campaign installation time. Use `ON CONFLICT (code) DO UPDATE` only for immutable campaign-owned fields so a stale deployment is repaired without modifying owner-authored records under other codes:

```ts
code: "early_bird_promo_2026_2027",
name: "Early Bird Promo — 10%",
state: "active",
audience: "customer_safe",
amountBasisPoints: 1000,
stackPolicy: "manual",
requiresOwnerConfirmation: false,
deadlineMode: "days_after_trigger",
deadlineDays: 30,
customerSummary: "For a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by the displayed promotion deadline.",
internalConditions: "Approved Early Bird Promo for qualifying sales emails sent through March 31, 2027. The first confirmed send sets one 30-day event deadline. Do not reset or stack automatically.",
sourceConflictNote: null,
reviewedBy: "conversation:2026-09-09",
reviewedAt: new Date("2026-09-09T00:00:00.000Z"),
```

Do not weaken the source-safety boundary: retain the tests that every Amy-derived seed is `proposed` and that the source-seed file contains no active rule. Add a PGlite test proving the separate campaign rule is active, idempotent, has no source-document link, and does not mutate `early_bird_10_percent`. Replace the old refresh assertion that prohibited `10% Early Bird` with assertions that seeded templates still contain no hard-coded deadline and the shared promo renderer owns the current customer promise.

- [ ] **Step 5: Run policy and commercial-offer tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo/early-bird-promo-policy.test.ts src/features/early-bird-promo/early-bird-promo-offer-seed.pglite.test.ts src/features/commercial-offers/commercial-offer-seed.test.ts src/features/commercial-offers/commercial-offer-source-safety.test.ts src/features/communication-templates/communication-template-seed-refresh.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the campaign policy**

```bash
git add artifacts/api-server/src/features/early-bird-promo artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-source-safety.test.ts artifacts/api-server/src/features/communication-templates/communication-template-seed-refresh.test.ts
git commit -m "feat: define early bird promo policy"
```

### Task 3: Apply the promotion to sales and current convention templates

**Files:**
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-service.ts`
- Modify: `artifacts/api-server/src/routes/office-communication-templates.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-seed.ts`
- Test: `artifacts/api-server/src/routes/office-communication-templates.test.ts`
- Test: `artifacts/api-server/src/features/communication-templates/early-bird-promo-convention-coverage.test.ts`

**Interfaces:**
- Consumes: Task 2 policy functions.
- Produces: `RenderedCommunicationTemplate.promotion` with `{ name, provisionalDeadlineDate, eligible, bookingId, eventYear } | null` and template-rendered bodies containing exactly one provisional promo block.
- The provisional date is a preview only; Tasks 4 and 5 replace it at the confirmed send boundary.

- [ ] **Step 1: Write failing renderer and convention coverage tests**

Create a table-driven test over the existing sales codes:

```ts
const eligibleCodes = [
  "new_event_intro", "state_fair_email", "past_customer_rebooking",
  "follow_up_next_season", "are_you_having_event_this_year",
  "pre_convention", "met_at_convention", "missed_at_convention",
  "package_specific_intro", "mini_zone_option", "budget_or_space_response",
];
```

For every seed with `category === "convention"`, render with `now = 2026-10-01T12:00:00Z` and assert one `Early Bird Promo`, no `12%`, and no structural changes outside the inserted block. Render each excluded code and assert no promo. Add a rich HTML convention fixture containing a responsive wrapper, animation CSS, images, CTA, and footer; assert all original markup survives and the promo appears before the footer.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/early-bird-promo-convention-coverage.test.ts src/routes/office-communication-templates.test.ts
```

Expected: FAIL because render results have no promotion metadata or block.

- [ ] **Step 3: Extend the render service at one integration seam**

Add optional inputs without accepting a client-supplied deadline:

```ts
now?: Date;
alreadyPaid?: boolean;
existingPromotionDeadlineDate?: string | null;
```

After normal placeholder rendering, call `earlyBirdPromoEligibility` with the stored template `category` and `code`. Use `existingPromotionDeadlineDate ?? earlyBirdPromoDates(now).deadlineDate` for the provisional display and return:

```ts
promotion: eligible ? {
  name: EARLY_BIRD_PROMO.name,
  provisionalDeadlineDate: deadlineDate,
  eligible: true,
  bookingId: promotionTarget.bookingId,
  eventYear: promotionTarget.eventYear,
} : null;
```

Do not add `offerDeadline` to the public authored-template placeholder allowlist. The deadline remains server-owned so private templates cannot forge or reset it.

Resolve `promotionTarget` server-side: prefer the earliest nonterminal upcoming booking for the organization and use its start year; otherwise use the nonterminal 2027 booking opportunity; if neither exists, use `{ bookingId: null, eventYear: EARLY_BIRD_PROMO.bookingYear }`. This explicit campaign-year fallback keeps new convention prospects eligible without inventing a different year per request.

- [ ] **Step 4: Make convention coverage category-driven**

Keep the existing `pre_convention`, `met_at_convention`, and `missed_at_convention` seed copy intact. Add no hard-coded percentage or date to those bodies. The test must discover all current `category: "convention"` seeds dynamically so current and future rich convention templates receive the shared block without code-by-code edits.

- [ ] **Step 5: Run template tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates src/routes/office-communication-templates.test.ts
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit template integration**

```bash
git add artifacts/api-server/src/features/communication-templates artifacts/api-server/src/routes/office-communication-templates.ts artifacts/api-server/src/routes/office-communication-templates.test.ts
git commit -m "feat: add early-bird promo to sales templates"
```

### Task 4: Record and manage promotion enrollments transactionally

**Files:**
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-repository.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-service.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-repository.pglite.test.ts`
- Test: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-service.test.ts`

**Interfaces:**
- Consumes: Task 1 table and Task 2 policy.
- Produces: `EarlyBirdPromoRepository` and `EarlyBirdPromoService`.
- Core service signatures:

```ts
prepareBody(input: PromoSendContext): Promise<{ body: string; eligible: boolean; deadlineDate: string | null }>;
recordConfirmedSend(input: PromoConfirmedSend): Promise<EarlyBirdPromoRecord | null>;
confirmInterest(input: { opportunityId: string; confirmedAt: Date; evidenceMessageId?: string | null }): Promise<EarlyBirdPromoRecord | null>;
recordDeposit(input: { organizationId: string; eventYear: number; receivedAt: Date; source: string }): Promise<EarlyBirdPromoRecord | null>;
cancel(input: { enrollmentId: string; reason: string; cancelledAt: Date }): Promise<EarlyBirdPromoRecord>;
```

- [ ] **Step 1: Write failing lifecycle tests**

Test these transitions with `firstSend.sentAt = 2026-09-10T15:00:00Z` and fixed day-five/day-ten/day-twelve/day-fifteen clocks:

```ts
await service.recordConfirmedSend(firstSend);
await service.recordConfirmedSend({ ...firstSend, emailRecordId: "second-email", sentAt: dayFive });
expect(repository.requireForProfileYear(ORG_ID, 2027).deadlineDate).toBe("2026-10-10");

await service.confirmInterest({ opportunityId: OPPORTUNITY_ID, confirmedAt: dayTen, evidenceMessageId: "gmail-reply-1" });
expect(repository.requireForProfileYear(ORG_ID, 2027).reminderDueAt).toEqual(dayFifteen);

await service.recordDeposit({ organizationId: ORG_ID, eventYear: 2027, receivedAt: dayTwelve, source: "manual_profile" });
expect(repository.requireForProfileYear(ORG_ID, 2027).status).toBe("secured");
```

Also cover: send outside campaign returns `null`; failed/unconfirmed send never calls `recordConfirmedSend`; repeated message ID is idempotent; interest after day 15 leaves `reminderDueAt` at day 15; interest after expiry creates no reminder; deposit and cancel release claims; expiration changes only active unpaid rows.

- [ ] **Step 2: Run the lifecycle tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo/early-bird-promo-repository.pglite.test.ts src/features/early-bird-promo/early-bird-promo-service.test.ts
```

Expected: FAIL because repository/service modules do not exist.

- [ ] **Step 3: Implement repository transactions and records**

Define `EarlyBirdPromoRecord` with all enrollment fields converted to `Date | null` as appropriate. Implement:

```ts
getForProfileYear(organizationId: string, eventYear: number): Promise<EarlyBirdPromoRecord | null>;
getForOpportunity(opportunityId: string): Promise<EarlyBirdPromoRecord | null>;
createFromConfirmedSend(input: CreatePromoEnrollmentInput): Promise<EarlyBirdPromoRecord>;
confirmInterest(input: ConfirmPromoInterestInput): Promise<EarlyBirdPromoRecord | null>;
secureWithDeposit(input: RecordPromoDepositInput): Promise<EarlyBirdPromoRecord | null>;
cancel(input: CancelPromoEnrollmentInput): Promise<EarlyBirdPromoRecord>;
expireDue(now: Date): Promise<number>;
claimOneReminder(input: { workerId: string; now: Date }): Promise<EarlyBirdPromoRecord | null>;
attachReminder(input: { enrollmentId: string; workerId: string; draftId: string; followUpId: string; now: Date }): Promise<EarlyBirdPromoRecord>;
releaseReminderClaim(input: { enrollmentId: string; workerId: string; now: Date }): Promise<void>;
```

Use `INSERT ... ON CONFLICT DO NOTHING` followed by a locked select so concurrent confirmations reuse the first row. `confirmInterest` sets `reminderDueAt` from `firstSentAt + 15 calendar days`, never from reply time. `claimOneReminder` selects only `active`, interested, unpaid, due, uncreated reminders with `FOR UPDATE SKIP LOCKED` and a 60-second lease.

- [ ] **Step 4: Implement service policy and activity audit hooks**

`prepareBody` loads the saved enrollment first. If one exists and is active, it reuses `deadlineDate`; otherwise it calculates a provisional first-send deadline. `recordConfirmedSend` resolves the active `early_bird_promo_2026_2027` rule, validates 1000 basis points and `days_after_trigger: 30`, creates/reuses the enrollment, and writes one activity body:

```text
Early Bird Promo sent. Deposit deadline: October 9, 2026.
```

`recordDeposit` marks the enrollment secured and completes a linked open reminder follow-up with outcome `Deposit received; Early Bird Promo secured.` It changes a linked unsent Office reminder draft to `cancelled` with owner-return note `Deposit received; reminder no longer needed.`

- [ ] **Step 5: Run lifecycle tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo
```

Expected: PASS.

- [ ] **Step 6: Commit lifecycle logic**

```bash
git add artifacts/api-server/src/features/early-bird-promo
git commit -m "feat: track early-bird promo lifecycle"
```

### Task 5: Finalize the date at both confirmed email send boundaries

**Files:**
- Modify: `artifacts/api-server/src/features/office/office-email-repository.ts`
- Modify: `artifacts/api-server/src/routes/office-admin-email-drafts.ts`
- Modify: `artifacts/api-server/src/features/office/office-email-types.ts`
- Modify: `artifacts/api-server/src/features/opportunity-email/opportunity-email-service.ts`
- Modify: `artifacts/api-server/src/features/opportunity-email/opportunity-email-workflow.ts`
- Modify: `artifacts/api-server/src/features/opportunity-email/production-opportunity-email-runtime.ts`
- Test: `artifacts/api-server/src/routes/office-email-drafts.test.ts`
- Test: `artifacts/api-server/src/routes/office-admin-email-drafts.test.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-email-delivery.test.ts`
- Test: `artifacts/api-server/src/features/opportunity-email/opportunity-email-reconciliation.test.ts`

**Interfaces:**
- Consumes: Task 4 `prepareBody` and `recordConfirmedSend`.
- Produces: both outgoing systems deliver and persist the identical finalized body/date, then record an enrollment only after confirmed provider success.

- [ ] **Step 1: Write failing Office send-boundary tests**

Use a fixed `attemptedAt = 2026-10-01T15:00:00Z`. Assert the delivery receives a body ending with an October 31, 2026 promo deadline; `markSent` stores exactly that body; `recordConfirmedSend` receives the real message ID; a provider failure calls neither enrollment creation nor `markSent`; retry on October 2 recalculates November 1 when no prior enrollment exists; and sending the `deposit_received` template calls `recordDeposit` instead of adding a promo.

- [ ] **Step 2: Write failing Opportunity send/reconciliation tests**

Assert `OpportunityEmailService.sendDraft` first updates the Gmail draft with the finalized promo body, then sends it, then records the confirmed send. For `GMAIL_SEND_OUTCOME_UNCERTAIN`, assert successful reconciliation records exactly one enrollment with reconciled `sentAt`; unsuccessful reconciliation creates none. A second qualifying email must use the stored original deadline.

- [ ] **Step 3: Run the send tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/office-admin-email-drafts.test.ts src/features/opportunity-email/opportunity-email-delivery.test.ts src/features/opportunity-email/opportunity-email-reconciliation.test.ts
```

Expected: FAIL because send paths do not call the promo service.

- [ ] **Step 4: Integrate the Office/Boss send route**

Extend the Office render response/editor save flow so `bookingId` and `eventYear` from Task 3 promotion metadata are persisted on `office_email_drafts`; add both optional fields to the Office create schema and validate that the booking belongs to the submitted organization. Extend `claimForSend`/view data to include template `code`, `category`, Office account, organization, contact, booking, and event-year context. Before `delivery.send`, call:

```ts
const attemptedAt = clock.now();
const prepared = await promo.prepareBody({
  sourceKind: "office_email",
  emailRecordId: claimed.id,
  organizationId: claimed.organizationId,
  bookingId: claimed.bookingId,
  contactId: claimed.contactId,
  officeAccountId: claimed.officeAccountId,
  eventYear: claimed.eventYear,
  templateCode: claimed.templateCode,
  templateCategory: claimed.templateCategory,
  body,
  attemptedAt,
});
```

Send `prepared.body`. After provider success and `markSent`, call `recordConfirmedSend` with `attemptedAt`, message ID, and finalized body context. Dependency-inject `clock`, `mailDelivery`, and promo service through `createOfficeAdminEmailDraftsRouter` so tests are deterministic.

- [ ] **Step 5: Integrate Opportunity Gmail send and reconciliation**

Add `promotion` to `OpportunityEmailServiceDependencies`. In `sendDraft`, call `prepareBody`, update the Gmail draft only when the body changes, persist the changed body, then send. Both direct confirmation and `reconcileSend` flow through one `confirmSent` method that calls `recordConfirmedSend` after durable email-state update. Keep the existing request-key idempotency return before provider work.

For Opportunity-generated drafts, pass `templateCategory: existing.purpose === "new_outreach" ? "outreach" : "follow_up"` and `templateCode: null`; resolve booking/event-year from `DraftContext` and the Opportunity record. Do not infer a convention category from free text.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/office-email-drafts.test.ts src/routes/office-admin-email-drafts.test.ts src/features/opportunity-email
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit send integration**

```bash
git add artifacts/api-server/src/features/office artifacts/api-server/src/routes/office-admin-email-drafts.ts artifacts/api-server/src/routes/office-email-drafts.test.ts artifacts/api-server/src/routes/office-admin-email-drafts.test.ts artifacts/api-server/src/features/opportunity-email
git commit -m "feat: start early-bird promo on confirmed send"
```

### Task 6: Turn confirmed interest into one reviewable day-15 reminder

**Files:**
- Modify: `artifacts/api-server/src/routes/opportunities.ts`
- Modify: `artifacts/api-server/src/routes/opportunities.test.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker-loop.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker.test.ts`
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/src/index.startup-order.test.ts`

**Interfaces:**
- Consumes: Task 4 repository/service.
- Produces: `EarlyBirdPromoWorker.runOne({ workerId, now })` returning `{ kind: "idle" } | { kind: "progress"; enrollmentId: string }`.
- The opportunity route treats only the accepted `apply-suggested-status` transition to `interested` as confirmed interest; merely suggesting interest creates no reminder.

- [ ] **Step 1: Write failing interest-transition tests**

Assert `PATCH /opportunities/:id` with `status: "interested"` still returns a suggestion and does not call `confirmInterest`. Assert `POST /opportunities/:id/apply-suggested-status` with `interested` updates the opportunity and calls:

```ts
promo.confirmInterest({
  opportunityId,
  confirmedAt: clock.now(),
  evidenceMessageId: null,
});
```

Repeated approval must be idempotent.

- [ ] **Step 2: Write failing reminder-worker tests**

Given a claimed enrollment, assert the worker creates:

```ts
{
  organizationId,
  contactId,
  bookingId: null,
  kind: "early_bird_promo",
  dueAt: reminderDueAt,
}
```

The organization-level follow-up deliberately uses `bookingId: null` so `DrizzleFollowUpRepository.create` does not replace an unrelated booking follow-up. Assert the worker also inserts one `office_email_drafts` row with `state: "submitted"`, `officeAccountId` copied when available (otherwise `null`), the original recipient, and this exact body:

```text
Hi {{contactName}},

Just a reminder—our Early Bird Promo ends {{offerDeadline}}. Submit your deposit by then to receive 10% off and secure your event date.

Thanks,
{{senderName}}
The Adventure Zone
```

The service resolves the saved contact/sender names before persistence. Assert a duplicate run reuses linked IDs, a deposit/expiration creates nothing, and a creation failure releases the lease.

- [ ] **Step 3: Run the tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/opportunities.test.ts src/features/early-bird-promo/early-bird-promo-worker.test.ts src/features/early-bird-promo/early-bird-promo-worker-loop.test.ts
```

Expected: FAIL because the interest hook and worker do not exist.

- [ ] **Step 4: Implement the route hook and reminder worker**

Dependency-inject the promo service and clock into `createOpportunitiesRouter`. Call `confirmInterest` only after the accepted status update. The worker claims one row, then calls a promotion-repository method that creates the organization-level follow-up and submitted Boss-review draft and attaches both IDs inside one database transaction. Do not call the generic follow-up repository from inside that transaction because it starts its own transaction. Release the lease on failure.

Use the existing `ScheduledEmailDispatcherLoop` lifecycle shape with these delays: 15 seconds idle, 1 second after progress, and 60 seconds after error. Expire due enrollments before claiming reminder work so no reminder is created at or after expiration.

- [ ] **Step 5: Start and stop the worker safely**

After the proposed source offers are seeded, call `ensureEarlyBirdPromoOffer(db)` so the separately approved campaign rule exists. Create the worker after required migrations and both offer seeds complete, start it in `startBackgroundWorkers`, include `earlyBirdPromoLoop.close()` in shutdown, and log startup/failure without preventing the API from serving. Add startup-order assertions for the campaign seed and that migration/seed completion precedes worker creation.

- [ ] **Step 6: Run reminder/startup tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/opportunities.test.ts src/features/early-bird-promo src/index.startup-order.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit reminder automation**

```bash
git add artifacts/api-server/src/routes/opportunities.ts artifacts/api-server/src/routes/opportunities.test.ts artifacts/api-server/src/features/early-bird-promo artifacts/api-server/src/index.ts artifacts/api-server/src/index.startup-order.test.ts
git commit -m "feat: prepare early-bird promo reminders"
```

### Task 7: Show and manage the promotion on event profiles

**Files:**
- Create: `artifacts/api-server/src/routes/early-bird-promo.ts`
- Create: `artifacts/api-server/src/routes/early-bird-promo.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify: `artifacts/api-server/src/routes/event-profiles.source-documents.test.ts`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Create: `artifacts/adventure-zone/src/components/event-profiles/early-bird-promo-card.tsx`
- Create: `artifacts/adventure-zone/src/components/event-profiles/early-bird-promo-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.test.tsx`

**Interfaces:**
- Consumes: Task 4 service/repository and Task 6 system drafts/follow-ups.
- Produces profile JSON field:

```ts
earlyBirdPromo: {
  id: string;
  name: "Early Bird Promo";
  status: "active" | "secured" | "expired" | "cancelled";
  firstSentAt: string;
  deadlineDate: string;
  expiresAt: string;
  interestConfirmedAt: string | null;
  reminderDueAt: string | null;
  reminderPrepared: boolean;
  depositReceivedAt: string | null;
} | null;
```

- [ ] **Step 1: Write failing route authorization/lifecycle tests**

Test:

```text
GET  /early-bird-promo/profile/:organizationId?eventYear=2027
POST /early-bird-promo/:enrollmentId/interest
POST /early-bird-promo/:enrollmentId/deposit
POST /early-bird-promo/:enrollmentId/cancel
```

Validate UUIDs, year 2000–2200, deposit `receivedAt` as an optional ISO timestamp defaulting to the server clock, and a nonblank cancellation reason up to 1000 characters. Require the existing owner/admin authorization middleware for deposit and cancellation. Interest may be confirmed from the authenticated booking workspace but may not include a client-forged Gmail evidence ID.

- [ ] **Step 2: Write failing profile-card tests**

Assert the card renders `Early Bird Promo`, status, formatted deadline, interest/reminder state, and deposit state. Active cards expose `Mark interest`, `Mark deposit received`, and `Cancel promo`; secured/expired/cancelled cards are read-only. Buttons require confirmation and refresh the profile after success. On a narrow viewport fixture, actions wrap vertically and no horizontal overflow class is introduced.

- [ ] **Step 3: Run route/component tests and verify they fail**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/early-bird-promo.test.ts src/routes/event-profiles.source-documents.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-profiles/early-bird-promo-card.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx
```

Expected: FAIL because routes, payload, and card do not exist.

- [ ] **Step 4: Add profile reads and reviewed mutations**

Mount the router in `routes/index.ts`. Fetch the enrollment by organization/event year and add it to the event-profile response without changing the existing repository’s canonical contact/booking logic. Manual deposit uses source `manual_profile`; the sent `deposit_received` template uses source `deposit_received_email`. Cancellation records the actor and reason in an audit entry.

- [ ] **Step 5: Add the compact profile card and Boss system-draft label**

Render the card near booking/follow-up information in `event-profile-workspace.tsx`. In `OfficeCoordinatorAdminPage`, render nullable-account submitted drafts normally and label them `Prepared automatically · Early Bird Promo reminder`. Keep Send, Edit & Send, and Return for Changes available; never add an automatic-send control.

- [ ] **Step 6: Run focused frontend/backend tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/early-bird-promo.test.ts src/routes/event-profiles.source-documents.test.ts src/routes/office-admin-email-drafts.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-profiles/early-bird-promo-card.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx src/components/event-profiles/event-profile-workspace.follow-up.test.tsx
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/adventure-zone run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit profile and review UI**

```bash
git add artifacts/api-server/src/routes/early-bird-promo.ts artifacts/api-server/src/routes/early-bird-promo.test.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/event-profiles.source-documents.test.ts artifacts/api-server/src/features/event-profiles/event-profile-repository.ts artifacts/adventure-zone/src/components/event-profiles/early-bird-promo-card.tsx artifacts/adventure-zone/src/components/event-profiles/early-bird-promo-card.test.tsx artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.test.tsx
git commit -m "feat: show early-bird promo on profiles"
```

### Task 8: Verify the complete workflow and production safety

**Files:**
- Create: `artifacts/api-server/src/features/early-bird-promo/early-bird-promo-integration.pglite.test.ts`
- Create: `docs/superpowers/reviews/2026-09-09-early-bird-promo-verification.md`

**Interfaces:**
- Consumes all previous tasks.
- Produces an evidence-backed verification record and a release-ready branch.

- [ ] **Step 1: Write the end-to-end PGlite workflow test**

The test must perform this exact sequence through public service/route boundaries:

1. Render a convention email on September 9 and observe one provisional promo block.
2. Confirm provider send on September 10 and persist an October 10 deadline.
3. Render a second sales email on September 14 and observe the unchanged October 10 deadline.
4. Confirm interest on September 16 and observe a September 25 reminder due date, calculated from the September 10 first send.
5. Run the worker September 25 and observe one organization follow-up and one submitted Boss-review draft.
6. Replay interest and worker calls and observe no duplicates.
7. Record the deposit September 27 and observe `secured`, completed follow-up, and cancelled unsent reminder draft.
8. Attempt another sales render and observe no promo block because payment is recorded.

- [ ] **Step 2: Run the complete targeted suite**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/early-bird-promo src/features/commercial-offers src/features/communication-templates src/features/opportunity-email src/routes/office-communication-templates.test.ts src/routes/office-email-drafts.test.ts src/routes/office-admin-email-drafts.test.ts src/routes/opportunities.test.ts src/routes/early-bird-promo.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/event-profiles/early-bird-promo-card.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx src/components/event-profiles/event-profile-workspace.follow-up.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks and builds**

Run:

```bash
pnpm --filter @workspace/db run build
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

Expected: all commands exit 0. If the repository has a pre-existing unrelated failure, record the exact command, message, and proof that files changed by this plan are not involved; do not claim a clean build.

- [ ] **Step 4: Run static promotion-safety checks**

Run:

```bash
rg -n "30 days|12% Convention Discount|10% Early Bird" artifacts/api-server/src/features/communication-templates artifacts/api-server/src/features/early-bird-promo artifacts/adventure-zone/src
rg -n "send\(" artifacts/api-server/src/features/early-bird-promo
git diff --check origin/main...HEAD
```

Expected: `30 days` appears only in internal conditions/tests, no customer template contains `12% Convention Discount` or `10% Early Bird`, the reminder worker contains no mail-delivery send call, and `git diff --check` is clean.

- [ ] **Step 5: Write the verification record**

Record the exact commands, exit codes, passing test counts, build results, migration idempotency evidence, and any unrelated baseline failure in `docs/superpowers/reviews/2026-09-09-early-bird-promo-verification.md`. Include a requirement-to-test table covering every acceptance criterion in the spec.

- [ ] **Step 6: Commit verification artifacts**

```bash
git add artifacts/api-server/src/features/early-bird-promo/early-bird-promo-integration.pglite.test.ts docs/superpowers/reviews/2026-09-09-early-bird-promo-verification.md
git commit -m "test: verify early bird promo workflow"
```

- [ ] **Step 7: Review the final branch before handoff**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: clean worktree; one focused commit per task; changes limited to the schema, promo policy/lifecycle, email integration seams, profile/Boss UI, tests, and verification documentation described above.
