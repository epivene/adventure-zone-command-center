# Commercial Offer Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Amy's mixed discount/payment notes into owner-controlled, reviewable commercial-offer rules so the app can preserve useful business logic without allowing Office, the assistant, call scripts, or templates to promise an unapproved discount or no-upfront arrangement.

**Architecture:** Add a dedicated `commercial_offer_rules` table linked to the reviewed business-source layer. Seed source-derived offers as `proposed`, never active, because the source contains conflicts and discretionary rules. Owner settings can edit/activate/archive rules; server helpers expose only explicitly Active, context-valid customer-safe offers to future booking/proposal flows, while Office Coordinator receives no automatic discount/payment authority.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing owner auth, existing package templates, existing business-source schema.

**Spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

## Global Constraints

- No source-derived discount or payment arrangement becomes active automatically.
- Owner controls active/inactive state, eligibility, stacking, deadlines, amounts, package restrictions, and customer-facing explanation.
- Office Coordinator cannot activate, edit, select, or promise commercial-offer rules.
- Guided call scripts may say that options can be checked; they may not state that an event qualifies.
- No-upfront-cost arrangements require explicit owner confirmation until a future deterministic eligibility model is separately approved.
- Convention source material conflicts on the response window (7 days in one 2026 template, 15 days in another); the rule must preserve that conflict instead of choosing one.
- Ticket-sales/revenue-share wording varies across the source material; no fixed percentage becomes active from the source automatically.
- Discretionary `Good Deal`, `Great Deal`, and `Make It Right` rules are owner-only and never returned through Office APIs.
- Event-specific contract pricing never creates or modifies a global commercial-offer rule.

---

### Task 1: Add commercial-offer rule schema and strict input types

**Files:**
- Create: `lib/db/src/commercial-offer-schema.ts`
- Create: `lib/db/migrations/20260822_commercial_offer_rules.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Create: `artifacts/api-server/src/features/commercial-offers/commercial-offer-input.ts`
- Test: `artifacts/api-server/src/features/commercial-offers/commercial-offer-schema.test.ts`
- Test: `artifacts/api-server/src/features/commercial-offers/commercial-offer-input.test.ts`

**Interfaces:**

```ts
export const commercialOfferKindValues = ["discount", "payment_option", "fee"] as const;
export const commercialOfferStateValues = ["proposed", "active", "archived"] as const;
export const commercialOfferCalculationValues = [
  "fixed_cents",
  "percent_basis_points",
  "revenue_share",
  "variable",
] as const;
export const commercialOfferStackPolicyValues = ["stackable", "exclusive", "manual"] as const;
export const commercialOfferDeadlineModeValues = ["none", "manual", "days_after_trigger", "fixed_date"] as const;
export const commercialOfferAudienceValues = ["owner_only", "customer_safe"] as const;
```

```text
commercial_offer_rules
  id uuid PK
  code text NOT NULL UNIQUE
  name text NOT NULL
  kind text NOT NULL CHECK discount|payment_option|fee
  state text NOT NULL CHECK proposed|active|archived
  audience text NOT NULL CHECK owner_only|customer_safe
  source_document_id uuid NULL FK business_source_documents set null
  calculation_type text NOT NULL CHECK fixed_cents|percent_basis_points|revenue_share|variable
  amount_cents integer NULL CHECK amount_cents >= 0
  amount_basis_points integer NULL CHECK 0 <= amount_basis_points AND amount_basis_points <= 10000
  calculation_scope text NULL
  stack_policy text NOT NULL CHECK stackable|exclusive|manual
  applies_to_package_codes text[] NOT NULL DEFAULT '{}'
  new_customer_only boolean NOT NULL DEFAULT false
  repeat_customer_only boolean NOT NULL DEFAULT false
  requires_owner_confirmation boolean NOT NULL DEFAULT true
  deadline_mode text NOT NULL CHECK none|manual|days_after_trigger|fixed_date
  deadline_days integer NULL CHECK deadline_days >= 0
  fixed_deadline date NULL
  customer_summary text NULL
  internal_conditions text NOT NULL
  source_conflict_note text NULL
  reviewed_by text NULL
  reviewed_at timestamptz NULL
  created_at / updated_at timestamptz NOT NULL
```

Validation must enforce calculation/deadline consistency:

```ts
export const commercialOfferInputSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/),
  name: z.string().trim().min(1).max(160),
  kind: z.enum(commercialOfferKindValues),
  state: z.enum(commercialOfferStateValues),
  audience: z.enum(commercialOfferAudienceValues),
  calculationType: z.enum(commercialOfferCalculationValues),
  amountCents: z.number().int().min(0).nullable(),
  amountBasisPoints: z.number().int().min(0).max(10000).nullable(),
  calculationScope: z.string().trim().max(200).nullable(),
  stackPolicy: z.enum(commercialOfferStackPolicyValues),
  appliesToPackageCodes: z.array(z.string().trim().min(1)).default([]),
  newCustomerOnly: z.boolean(),
  repeatCustomerOnly: z.boolean(),
  requiresOwnerConfirmation: z.boolean(),
  deadlineMode: z.enum(commercialOfferDeadlineModeValues),
  deadlineDays: z.number().int().min(0).nullable(),
  fixedDeadline: z.string().date().nullable(),
  customerSummary: z.string().trim().max(2000).nullable(),
  internalConditions: z.string().trim().min(1).max(4000),
  sourceConflictNote: z.string().trim().max(4000).nullable(),
}).superRefine((value, ctx) => {
  if (value.calculationType === "fixed_cents" && value.amountCents === null) {
    ctx.addIssue({ code: "custom", path: ["amountCents"], message: "Fixed offers require amountCents." });
  }
  if (value.calculationType === "percent_basis_points" && value.amountBasisPoints === null) {
    ctx.addIssue({ code: "custom", path: ["amountBasisPoints"], message: "Percent offers require amountBasisPoints." });
  }
  if (value.deadlineMode === "days_after_trigger" && value.deadlineDays === null) {
    ctx.addIssue({ code: "custom", path: ["deadlineDays"], message: "Relative deadlines require deadlineDays." });
  }
  if (value.deadlineMode === "fixed_date" && value.fixedDeadline === null) {
    ctx.addIssue({ code: "custom", path: ["fixedDeadline"], message: "Fixed deadlines require fixedDeadline." });
  }
});
```

- [ ] **Step 1: Write failing schema/input tests**

```ts
it("requires an amount for fixed discounts", () => {
  const parsed = commercialOfferInputSchema.safeParse({
    ...validOffer,
    calculationType: "fixed_cents",
    amountCents: null,
  });
  expect(parsed.success).toBe(false);
});

it("allows proposed variable payment options without inventing a percentage", () => {
  const parsed = commercialOfferInputSchema.safeParse({
    ...validOffer,
    kind: "payment_option",
    state: "proposed",
    calculationType: "variable",
    amountCents: null,
    amountBasisPoints: null,
  });
  expect(parsed.success).toBe(true);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-schema.test.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-input.test.ts
```

- [ ] **Step 3: Implement migration/schema/input exactly as defined above**

Add indexes on `(state, audience, kind)`, source document ID, and package-code GIN if the repository already enables GIN migrations; otherwise use the state/audience index only in Release 1.

- [ ] **Step 4: Run tests/typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-schema.test.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-input.test.ts
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/commercial-offer-schema.ts lib/db/migrations/20260822_commercial_offer_rules.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-input.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-schema.test.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-input.test.ts
git commit -m "feat: add commercial offer rule model"
```

---

### Task 2: Seed Amy-derived commercial offers as proposed review items only

**Files:**
- Create: `artifacts/api-server/src/features/commercial-offers/commercial-offer-repository.ts`
- Create: `artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.ts`
- Test: `artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts`

**Interfaces:**

```ts
export async function ensureCommercialOfferSeed(database: DrizzleDatabase): Promise<void>;
```

Every source seed below starts with `state='proposed'` and `requiresOwnerConfirmation=true`.

```ts
const COMMERCIAL_OFFER_SEEDS = [
  {
    code: "repeat_customer_500",
    name: "$500 repeat customer discount",
    kind: "discount",
    audience: "customer_safe",
    calculationType: "fixed_cents",
    amountCents: 50000,
    amountBasisPoints: null,
    calculationScope: "per eligible booking",
    stackPolicy: "manual",
    repeatCustomerOnly: true,
    newCustomerOnly: false,
    deadlineMode: "none",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "A repeat-customer discount may be available for returning events.",
    internalConditions: "Sticky Notes p.13 lists a $500 repeat-customer discount. Stacking varied by campaign; owner must confirm before use.",
    sourceConflictNote: null,
  },
  {
    code: "double_booking_250",
    name: "$250 multiple-booking discount",
    kind: "discount",
    audience: "customer_safe",
    calculationType: "fixed_cents",
    amountCents: 25000,
    amountBasisPoints: null,
    calculationScope: "per unit or qualifying consecutive weekend as approved by owner",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "none",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "A multiple-booking discount may be available when booking more than one unit or qualifying consecutive weekends.",
    internalConditions: "Sticky Notes pp.13-14 describe $250 per unit/per qualifying weekend. Owner confirms how it applies to the specific booking.",
    sourceConflictNote: null,
  },
  {
    code: "early_bird_10_percent",
    name: "10% early-bird discount",
    kind: "discount",
    audience: "customer_safe",
    calculationType: "percent_basis_points",
    amountCents: null,
    amountBasisPoints: 1000,
    calculationScope: "eligible booking subtotal",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "manual",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "An early-booking discount may be available when the signed contract and deposit are received by the approved deadline.",
    internalConditions: "Sticky Notes repeatedly describe 10% early-bird pricing but use campaign-specific dates. Owner enters the current deadline before activation/use.",
    sourceConflictNote: null,
  },
  {
    code: "convention_12_percent",
    name: "12% convention discount",
    kind: "discount",
    audience: "customer_safe",
    calculationType: "percent_basis_points",
    amountCents: null,
    amountBasisPoints: 1200,
    calculationScope: "eligible booking subtotal",
    stackPolicy: "exclusive",
    repeatCustomerOnly: false,
    newCustomerOnly: true,
    deadlineMode: "manual",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "A convention discount may be available for qualifying new customers during an approved convention offer period.",
    internalConditions: "Sticky Notes pp.14-15 and p.20 say no other discounts apply to the convention discount.",
    sourceConflictNote: "Source conflict: one 2026 template says deposit within 7 days of convention; another says within 15 days. Owner must set the campaign deadline manually.",
  },
  {
    code: "good_deal_5_percent",
    name: "5% Good Deal discretionary discount",
    kind: "discount",
    audience: "owner_only",
    calculationType: "percent_basis_points",
    amountCents: null,
    amountBasisPoints: 500,
    calculationScope: "owner-selected booking amount",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "manual",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: null,
    internalConditions: "Sticky Notes p.14. Owner discretion only.",
    sourceConflictNote: null,
  },
  {
    code: "great_deal_7_percent",
    name: "7% Great Deal discretionary discount",
    kind: "discount",
    audience: "owner_only",
    calculationType: "percent_basis_points",
    amountCents: null,
    amountBasisPoints: 700,
    calculationScope: "owner-selected booking amount",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "manual",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: null,
    internalConditions: "Sticky Notes p.14. Owner discretion only.",
    sourceConflictNote: null,
  },
  {
    code: "make_it_right_variable",
    name: "Make It Right discretionary discount",
    kind: "discount",
    audience: "owner_only",
    calculationType: "variable",
    amountCents: null,
    amountBasisPoints: null,
    calculationScope: "owner-selected booking amount",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "manual",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: null,
    internalConditions: "Sticky Notes pp.14 and 23 use a variable Make It Right percentage. Never infer the percentage.",
    sourceConflictNote: null,
  },
  {
    code: "ticket_sales_with_guarantee",
    name: "Ticket sales with guarantee",
    kind: "payment_option",
    audience: "customer_safe",
    calculationType: "variable",
    amountCents: null,
    amountBasisPoints: null,
    calculationScope: "event-specific guarantee and revenue-share terms",
    stackPolicy: "exclusive",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "none",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "Some events may qualify for a ticket-sales arrangement with an agreed guarantee and possible revenue share.",
    internalConditions: "Sticky Notes pp.30-32 describe any available unit at no upfront cost only with a guarantee equivalent to normal pricing, followed by a percentage if the threshold is reached. Exact guarantee/share requires owner confirmation.",
    sourceConflictNote: "Revenue-share percentage is not consistent across newer source wording; do not fill one automatically.",
  },
  {
    code: "zone_mini_ticket_sales_no_guarantee",
    name: "Adventure Zone / Mini Zone ticket sales without guarantee",
    kind: "payment_option",
    audience: "customer_safe",
    calculationType: "variable",
    amountCents: null,
    amountBasisPoints: null,
    calculationScope: "Adventure Zone or Mini Zone only when owner confirms eligibility",
    stackPolicy: "exclusive",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "none",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: "In some situations, Adventure Zone or Mini Zone may be available through ticket sales without a guarantee, subject to event approval.",
    internalConditions: "Sticky Notes pp.30-31 say this is available only in some instances. No deterministic eligibility rule is approved yet.",
    sourceConflictNote: null,
  },
  {
    code: "reduced_public_rate_admin_fee_20_percent",
    name: "20% reduced-public-rate administrative fee",
    kind: "fee",
    audience: "owner_only",
    calculationType: "percent_basis_points",
    amountCents: null,
    amountBasisPoints: 2000,
    calculationScope: "amount handled under the reduced-public-rate arrangement",
    stackPolicy: "manual",
    repeatCustomerOnly: false,
    newCustomerOnly: false,
    deadlineMode: "none",
    deadlineDays: null,
    fixedDeadline: null,
    customerSummary: null,
    internalConditions: "Sticky Notes p.6 says a 20% administrative fee applies when public pricing is reduced to recoup event costs. Owner confirmation required before use.",
    sourceConflictNote: null,
  },
];
```

- [ ] **Step 1: Write seed/idempotency tests**

```ts
it("never activates source-derived offers automatically", async () => {
  await ensureCommercialOfferSeed(db);
  const rows = await repository.listAll();
  expect(rows).toHaveLength(COMMERCIAL_OFFER_SEEDS.length);
  expect(rows.every((row) => row.state === "proposed")).toBe(true);
});

it("preserves the convention deadline conflict", async () => {
  await ensureCommercialOfferSeed(db);
  const convention = await repository.getByCode("convention_12_percent");
  expect(convention?.deadlineMode).toBe("manual");
  expect(convention?.sourceConflictNote).toContain("7 days");
  expect(convention?.sourceConflictNote).toContain("15 days");
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts
```

- [ ] **Step 3: Implement repository and idempotent seed**

Resolve the Sticky Notes source document by `original_filename='ADVENTURE ZONE STICKY NOTES.docx.pdf'`. Seed only missing codes; never overwrite an owner-edited existing rule.

- [ ] **Step 4: Run tests/typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/commercial-offers/commercial-offer-repository.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.test.ts
git commit -m "feat: seed proposed Adventure Zone offer rules"
```

---

### Task 3: Add owner-only commercial-offer API and settings editor

**Files:**
- Create: `artifacts/api-server/src/routes/commercial-offers.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/components/packages/commercial-offer-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx`
- Test: `artifacts/api-server/src/routes/commercial-offers.test.ts`
- Test: `artifacts/adventure-zone/src/components/packages/commercial-offer-editor.test.tsx`

**Owner routes:**

```text
GET   /commercial-offers
POST  /commercial-offers
PATCH /commercial-offers/:offerId
POST  /commercial-offers/:offerId/activate
POST  /commercial-offers/:offerId/archive
```

Activation validation:

```ts
export function validateOfferActivation(offer: CommercialOfferRecord): string[] {
  const errors: string[] = [];
  if (offer.sourceConflictNote?.trim()) errors.push("Resolve or explicitly accept the source conflict before activation.");
  if (offer.calculationType === "fixed_cents" && offer.amountCents === null) errors.push("Enter the fixed amount.");
  if (offer.calculationType === "percent_basis_points" && offer.amountBasisPoints === null) errors.push("Enter the percentage.");
  if (offer.deadlineMode === "manual" && offer.kind === "discount") errors.push("Set the current offer deadline or change the deadline mode before activation.");
  if (!offer.internalConditions.trim()) errors.push("Internal conditions are required.");
  if (offer.audience === "customer_safe" && !offer.customerSummary?.trim()) errors.push("Customer-safe offers require a customer explanation.");
  return errors;
}
```

For a source conflict such as convention timing, owner activation UI presents the conflict and an explicit `I confirmed the current terms` action. That action clears `sourceConflictNote` only after the owner edits the current rule to the confirmed terms; it does not silently choose 7 or 15 days.

- [ ] **Step 1: Write API activation/security tests**

```ts
it("rejects activation while a source conflict remains", async () => {
  const response = await ownerRequest.post(`/commercial-offers/${convention.id}/activate`).send();
  expect(response.status).toBe(409);
  expect(response.body.errors).toContain("Resolve or explicitly accept the source conflict before activation.");
});

it("does not mount the rule editor on Office routes", async () => {
  const response = await officeRequest.get("/commercial-offers");
  expect([401, 403, 404]).toContain(response.status);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/commercial-offers.test.ts
```

- [ ] **Step 3: Implement owner router and `Offers & Discounts` editor**

Place a collapsed `Offers & Discounts` section on `SettingsPackagesResourcesPage`. Each card shows state, kind, amount, package scope, stacking policy, eligibility flags, deadline, customer explanation, internal conditions, source conflict, Activate, and Archive. Discretionary owner-only offers display an `Owner only` badge.

- [ ] **Step 4: Run API/UI tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/commercial-offers.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/packages/commercial-offer-editor.test.tsx
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/commercial-offers.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/components/packages/commercial-offer-editor.tsx artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx artifacts/api-server/src/routes/commercial-offers.test.ts artifacts/adventure-zone/src/components/packages/commercial-offer-editor.test.tsx
git commit -m "feat: add owner-controlled offer settings"
```

---

### Task 4: Enforce active-rule use and prevent Office/call/template leakage

**Files:**
- Create: `artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Modify: `artifacts/api-server/src/routes/office-communication-templates.ts`
- Test: `artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.test.ts`
- Test: `artifacts/api-server/src/routes/office-communication-templates.test.ts`
- Test: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts`

**Interfaces:**

```ts
export type CommercialOfferUseContext = {
  packageCode: string | null;
  isRepeatCustomer: boolean;
  isNewCustomer: boolean;
  currentDate: string;
};

export function canUseCommercialOffer(
  offer: CommercialOfferRecord,
  context: CommercialOfferUseContext,
): { allowed: boolean; reason: string | null } {
  if (offer.state !== "active") return { allowed: false, reason: "Offer is not active." };
  if (offer.requiresOwnerConfirmation) return { allowed: false, reason: "Owner confirmation is required for this event." };
  if (offer.repeatCustomerOnly && !context.isRepeatCustomer) return { allowed: false, reason: "Repeat customers only." };
  if (offer.newCustomerOnly && !context.isNewCustomer) return { allowed: false, reason: "New customers only." };
  if (offer.appliesToPackageCodes.length > 0 && (!context.packageCode || !offer.appliesToPackageCodes.includes(context.packageCode))) {
    return { allowed: false, reason: "Offer does not apply to this package." };
  }
  if (offer.fixedDeadline && context.currentDate > offer.fixedDeadline) return { allowed: false, reason: "Offer deadline has passed." };
  return { allowed: true, reason: null };
}
```

Release 1 intentionally leaves `requires_owner_confirmation=true` for all source-seeded payment options and discretionary discounts. The owner may turn that flag off only after deciding the rule is deterministic enough to be used without per-event approval.

Template behavior:
- Office template rendering never auto-selects a commercial offer.
- Office APIs do not list proposed, owner-only, or confirmation-required rules.
- If a later owner-approved template render explicitly supplies an offer ID, the renderer must call `canUseCommercialOffer` and fail closed when it is not allowed.
- Guided-call budget/space branches continue to say `I can check what might fit`; they do not quote a source-seeded rule.

- [ ] **Step 1: Write policy and Office leakage tests**

```ts
it("fails closed for a proposed source rule", () => {
  expect(canUseCommercialOffer({ ...offer, state: "proposed" }, context)).toEqual({
    allowed: false,
    reason: "Offer is not active.",
  });
});

it("fails closed while owner confirmation is required", () => {
  expect(canUseCommercialOffer({ ...offer, state: "active", requiresOwnerConfirmation: true }, context).allowed).toBe(false);
});
```

Office route test must assert the JSON payload contains no `commercialOffers`, `sourceConflictNote`, discretionary rule names, or raw commercial-rule rows.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.test.ts artifacts/api-server/src/routes/office-communication-templates.test.ts
```

- [ ] **Step 3: Implement the policy helper and fail-closed renderer hook**

The existing Office render endpoint continues to work without an offer ID. Add an internal renderer option `commercialOfferId?: string | null` for owner/proposal flows, but reject that option from the Office route schema in Release 1.

- [ ] **Step 4: Run commercial/template/call regressions**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.test.ts artifacts/api-server/src/routes/office-communication-templates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.ts artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts artifacts/api-server/src/routes/office-communication-templates.ts artifacts/api-server/src/features/commercial-offers/commercial-offer-policy.test.ts artifacts/api-server/src/routes/office-communication-templates.test.ts artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts
git commit -m "feat: guard commercial offer usage"
```

---

### Task 5: Full commercial-offer regression and source-safety verification

**Files:**
- Modify only tracked files required by failures found here.

- [ ] **Step 1: Run all commercial-offer tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/commercial-offers artifacts/api-server/src/routes/commercial-offers.test.ts artifacts/api-server/src/routes/office-communication-templates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/packages/commercial-offer-editor.test.tsx artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Verify every source-seeded commercial offer still starts Proposed**

```bash
rg -n "state:\s*\"active\"" artifacts/api-server/src/features/commercial-offers/commercial-offer-seed.ts && exit 1 || true
```

Expected: no active source seeds.

- [ ] **Step 4: Verify Office-safe source has no discretionary discount language**

```bash
rg -n "Good Deal|Great Deal|Make It Right|convention_12_percent|repeat_customer_500" artifacts/api-server/src/routes/office-communication-templates.ts artifacts/adventure-zone/src/components/office || true
```

Expected: no direct rule exposure in Office code.

- [ ] **Step 5: Commit verification fixes if required**

```bash
git add -u
git diff --cached --quiet || git commit -m "test: harden commercial offer rules"
```
