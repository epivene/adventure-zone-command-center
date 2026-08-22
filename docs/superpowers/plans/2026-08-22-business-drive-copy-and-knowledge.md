# Business Drive Copy + Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the reviewed business-drive files into traceable business knowledge, corrected package defaults, professionally edited communication templates, and selective guided-call branches without replacing the current preferred call wording or exposing sensitive source data.

**Architecture:** Add a small source/provenance schema and a separate communication-template schema, then layer owner-only review/editing APIs over them. Package and template rendering consume reviewed structured values; Office Coordinator rendering is read-only and produces an editable draft snapshot. Guided call additions remain code-defined workflow nodes so editable wording cannot change dispositions or branch destinations.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing Office Coordinator auth, existing package settings, existing guided call script graph.

**Spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

## Global Constraints

- The six uploaded business files are source material, not automatically authoritative operational truth.
- Existing guided-call wording remains the default when it is clearer or more natural.
- Amy-derived scripts/templates must be rewritten for grammar, spelling, punctuation, capitalization, sentence flow, consistent package names, and a warm professional tone before activation.
- Live-call text should normally be one or two speakable sentences before pausing for a response.
- Reusable templates must not hard-code employee names, obsolete dates, package prices, discounts, or unsupported promises.
- Package prices, duration, and other changing facts render from reviewed structured data whenever practical.
- The no-upfront-cost option is never presented as automatically available; copy must state that eligibility/availability must be confirmed.
- Event-specific contracts never overwrite universal package defaults.
- Sensitive business identifiers, private reference-contact lists, discretionary discount rules, and source conflicts remain owner-only.
- Office Coordinator can use Active office-safe templates to create/edit/submit drafts but cannot send email.
- Unknown template placeholders are rejected; unresolved required placeholders block submit/send.
- The current protected call graph remains code-controlled; owner wording overrides can change only `say` and `coach` text.

---

### Task 1: Add business-source and communication-template schema

**Files:**
- Create: `lib/db/src/business-source-schema.ts`
- Create: `lib/db/migrations/20260822_business_source_copy.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `lib/db/src/office-coordinator-schema.ts`
- Test: `artifacts/api-server/src/features/business-sources/business-source-schema.test.ts`

**Interfaces:**
- Produces: `businessSourceDocuments`, `businessSourceFactReviews`, `communicationTemplates`, `communicationTemplateStateValues`, `communicationTemplateAccessValues`.
- Extends: `office_email_drafts.communication_template_id` as a nullable FK so a rendered template can retain provenance without making the draft body dynamic after creation.

**Schema:**

```ts
export const communicationTemplateStateValues = ["draft", "reviewed", "active", "archived"] as const;
export const communicationTemplateAccessValues = ["owner", "office"] as const;

business_source_documents
  id uuid PK
  original_filename text NOT NULL UNIQUE
  display_title text NOT NULL
  source_category text NOT NULL
  effective_year integer NULL
  access_scope text NOT NULL CHECK owner|office|manager|public_template
  review_state text NOT NULL CHECK unreviewed|reviewed|superseded|archived
  storage_reference text NULL
  notes text NULL
  reviewed_by text NULL
  reviewed_at timestamptz NULL
  created_at / updated_at timestamptz NOT NULL

business_source_fact_reviews
  id uuid PK
  source_document_id uuid NOT NULL FK
  fact_key text NOT NULL
  entity_kind text NOT NULL
  entity_key text NULL
  proposed_value text NOT NULL
  normalized_value text NULL
  source_locator text NOT NULL
  review_state text NOT NULL CHECK proposed|approved|conflict|rejected|superseded
  conflict_group text NULL
  reviewer text NULL
  reviewed_at timestamptz NULL
  created_at / updated_at timestamptz NOT NULL

communication_templates
  id uuid PK
  code text NOT NULL UNIQUE
  name text NOT NULL
  channel text NOT NULL CHECK email|internal_email
  category text NOT NULL
  subject_template text NULL
  body_template text NOT NULL
  allowed_placeholders text[] NOT NULL DEFAULT '{}'
  required_placeholders text[] NOT NULL DEFAULT '{}'
  access_scope text NOT NULL CHECK owner|office
  state text NOT NULL CHECK draft|reviewed|active|archived
  source_document_id uuid NULL FK
  source_note text NULL
  reviewed_by text NULL
  reviewed_at timestamptz NULL
  created_at / updated_at timestamptz NOT NULL
```

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import {
  businessSourceDocuments,
  businessSourceFactReviews,
  communicationTemplates,
} from "@workspace/db";
import { officeEmailDrafts } from "@workspace/db";

describe("business source schema", () => {
  it("exports source, fact-review, and template tables", () => {
    expect(businessSourceDocuments.originalFilename).toBeDefined();
    expect(businessSourceFactReviews.sourceLocator).toBeDefined();
    expect(communicationTemplates.requiredPlaceholders).toBeDefined();
    expect(officeEmailDrafts.communicationTemplateId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/business-source-schema.test.ts
```

Expected: FAIL because the business-source exports and draft FK do not exist.

- [ ] **Step 3: Implement the migration and matching Drizzle schema**

Use FK `ON DELETE SET NULL` from `communication_templates.source_document_id` and `office_email_drafts.communication_template_id`, and `ON DELETE CASCADE` from fact reviews to their source document. Add indexes on `(review_state, conflict_group)`, `(entity_kind, entity_key)`, `(state, access_scope, category)`, and source document category/review state.

- [ ] **Step 4: Export the schema and update Office draft typing**

Keep the existing Office email state model unchanged. `communicationTemplateId` is provenance only and must never grant Office send permission.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/business-source-schema.test.ts
pnpm run typecheck
git add lib/db/src/business-source-schema.ts lib/db/migrations/20260822_business_source_copy.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts lib/db/src/office-coordinator-schema.ts artifacts/api-server/src/features/business-sources/business-source-schema.test.ts
git commit -m "feat: add business source and template schema"
```

---

### Task 2: Seed the six source-document records and explicit fact conflicts

**Files:**
- Create: `artifacts/api-server/src/features/business-sources/business-source-seed.ts`
- Create: `artifacts/api-server/src/features/business-sources/business-source-repository.ts`
- Test: `artifacts/api-server/src/features/business-sources/business-source-seed.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Interfaces:**

```ts
export type BusinessSourceSeed = {
  originalFilename: string;
  displayTitle: string;
  sourceCategory: "scripts_templates" | "operations" | "inventory" | "attendance" | "contract" | "vendor_application";
  effectiveYear: number | null;
  accessScope: "owner" | "office" | "manager" | "public_template";
  notes: string;
};

export async function ensureBusinessSourceSeed(database: DrizzleDatabase): Promise<void>;
```

**Seed records:**

```ts
const SOURCE_SEEDS: BusinessSourceSeed[] = [
  { originalFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf", displayTitle: "Adventure Zone Sticky Notes", sourceCategory: "scripts_templates", effectiveYear: 2026, accessScope: "owner", notes: "Mixed historical/current scripts, package facts, internal notes, discounts, contacts, and ACT workflow. Reviewed selectively; never publish verbatim." },
  { originalFilename: "Adventure Zone Attended Calendar.xlsx", displayTitle: "Adventure Zone Attended Calendar", sourceCategory: "attendance", effectiveYear: 2026, accessScope: "owner", notes: "Event attendance matrix. X=attended, B=blacklisted, C=cancelled last minute. Years shown 2020-2030; populated data currently through 2026." },
  { originalFilename: "Inflatable List.pdf", displayTitle: "Inflatable Asset List", sourceCategory: "inventory", effectiveYear: null, accessScope: "owner", notes: "Nine named inflatable assets with year, make, model, and serial number." },
  { originalFilename: "Inflatables (carnival).docx.pdf", displayTitle: "Inflatable Inspection Checklist", sourceCategory: "operations", effectiveYear: null, accessScope: "manager", notes: "Base inspection categories and acceptable/needs-work/unsafe result meanings; event checklists extend this source rather than copy its weekly grid." },
  { originalFilename: "pirates rebellion contract.pdf", displayTitle: "Ravalli County Fair Pirate's Rebellion Contract", sourceCategory: "contract", effectiveYear: 2025, accessScope: "owner", notes: "Event-specific signed agreement and rider. Historical terms must not overwrite universal package defaults." },
  { originalFilename: "VENDOR APP 2026.docx", displayTitle: "Hawthorne Armed Forces Day Vendor Application", sourceCategory: "vendor_application", effectiveYear: 2026, accessScope: "owner", notes: "Historical 2026 application/rules with April 25, 2026 deadline. Normal booth sizes are not Adventure Zone package footprints." },
];
```

Seed these conflict fact reviews with `review_state='conflict'`:

```ts
[
  { factKey: "mini_zone.ballast.water_barrels", proposedValue: "44", sourceLocator: "Sticky Notes p.30", conflictGroup: "mini_zone_water_barrels" },
  { factKey: "mini_zone.ballast.water_barrels", proposedValue: "50", sourceLocator: "Sticky Notes p.7", conflictGroup: "mini_zone_water_barrels" },
  { factKey: "package.base_duration_days", proposedValue: "1-5", sourceLocator: "Older Sticky Notes templates", conflictGroup: "package_duration" },
  { factKey: "package.base_duration_days", proposedValue: "1-4", sourceLocator: "2026 Sticky Notes pricing/templates", conflictGroup: "package_duration" },
  { factKey: "payment.no_upfront_eligibility", proposedValue: "multiple historical descriptions", sourceLocator: "Sticky Notes pp.17-32", conflictGroup: "no_upfront_eligibility" },
]
```

- [ ] **Step 1: Write seed idempotency and conflict tests**

Assert that running the seed twice creates six documents once, creates the conflict rows once, and never stores EIN, sales-tax ID, reference phone/email lists, or contract signatures in source notes.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/business-source-seed.test.ts
```

- [ ] **Step 3: Implement repository + idempotent seed**

Use `original_filename` as the stable document key and `(source_document_id, fact_key, source_locator)` as the fact-review idempotency key.

- [ ] **Step 4: Run the seed after the API binds its port**

Follow the existing post-listen maintenance pattern; do not block startup on source seeding. Log failures and retry on first owner source-review request.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/business-source-seed.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/business-sources/business-source-seed.ts artifacts/api-server/src/features/business-sources/business-source-repository.ts artifacts/api-server/src/features/business-sources/business-source-seed.test.ts artifacts/api-server/src/index.ts
git commit -m "feat: seed reviewed business source metadata"
```

---

### Task 3: Correct package defaults and add Mini Zone without hiding source conflicts

**Files:**
- Modify: `artifacts/api-server/src/features/packages/package-defaults.ts`
- Modify: `artifacts/api-server/src/features/packages/package-intelligence-settings.ts`
- Modify: `artifacts/api-server/src/features/packages/package-input.ts`
- Modify: `artifacts/adventure-zone/src/components/packages/package-template-editor.tsx`
- Test: `artifacts/api-server/src/features/packages/package-defaults.test.ts`
- Test: `artifacts/adventure-zone/src/components/packages/package-template-editor.test.tsx`

**Interfaces:**

Extend package settings records with:

```ts
baseDurationMinDays: number | null;
baseDurationMaxDays: number | null;
knowledgeReviewNote: string | null;
```

**Reviewed starting defaults:**

```ts
Adventure Zone:       $9,000; count target 10-12; duration 1-4 days
Pirate's Rebellion:   $7,500; count target 3;     duration 1-4 days
Warrior's Playground: $7,500; count target 5;     duration 1-4 days
Mini Zone:             $5,000; count target 5;     duration 1-4 days
```

Use reviewed requirements from the source only where the source is internally consistent. For Mini Zone ballast, leave the water-barrel count out of the approved operational text and add `knowledgeReviewNote = "Water-barrel source conflict: 44 vs 50; confirm before quoting."`.

- [ ] **Step 1: Write failing defaults tests**

```ts
expect(byCode.get("adventure_zone")?.basePriceCents).toBe(900000);
expect(byCode.get("pirates_rebellion")?.basePriceCents).toBe(750000);
expect(byCode.get("weekend_warriors")?.basePriceCents).toBe(750000);
expect(byCode.get("mini_zone")?.basePriceCents).toBe(500000);
expect(byCode.get("mini_zone")?.baseAttractionCount).toBe(5);
```

Also assert all four templates have duration `1..4` and Mini Zone does not silently choose `44` or `50` barrels in its approved requirements.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/packages/package-defaults.test.ts
```

- [ ] **Step 3: Add duration/review-note columns and update defaults**

Use the package settings/migration path rather than runtime-only hidden defaults. Keep values editable and preserve existing user-edited package rows; update seed values only for rows that still equal the old known seed values (`800000`, `700000`, or null for Warrior) so owner edits are not overwritten.

- [ ] **Step 4: Add Mini Zone to the owner package editor**

Show duration and `knowledgeReviewNote` underneath operational requirements. The review note is owner-facing guidance, not customer copy.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/packages/package-defaults.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/packages/package-template-editor.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/features/packages/package-defaults.ts artifacts/api-server/src/features/packages/package-intelligence-settings.ts artifacts/api-server/src/features/packages/package-input.ts artifacts/adventure-zone/src/components/packages/package-template-editor.tsx artifacts/api-server/src/features/packages/package-defaults.test.ts artifacts/adventure-zone/src/components/packages/package-template-editor.test.tsx
git commit -m "feat: refresh 2026 package knowledge"
```

---

### Task 4: Build validated communication-template rendering and seed polished copy

**Files:**
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-seed.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.test.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-seed.test.ts`

**Interfaces:**

```ts
export const allowedTemplatePlaceholders = [
  "contactName", "eventName", "eventCity", "eventState", "eventDates",
  "senderName", "senderPhone", "senderEmail", "packageName", "packagePrice",
  "packageDuration", "followUpDate",
] as const;

export type RenderedCommunicationTemplate = {
  templateId: string;
  subject: string;
  body: string;
  missingRequiredFields: string[];
};

export async function renderCommunicationTemplate(input: {
  templateId: string;
  organizationId: string;
  contactId: string;
  packageTemplateId?: string | null;
  sender: { name: string; phone: string | null; email: string | null };
}): Promise<RenderedCommunicationTemplate>;
```

**Seed Active office-safe templates with this polished intent/copy:**

```ts
const TEMPLATE_SEEDS = [
  {
    code: "new_event_intro",
    name: "New event introduction",
    category: "outreach",
    subject: "The Adventure Zone for {{eventName}}",
    body: `Hi {{contactName}},\n\nI'm reaching out from The Adventure Zone about {{eventName}}. We're a traveling event company that brings a staffed inflatable-carnival experience to fairs, festivals, and community events.\n\nI'd love to learn what you're planning and see whether one of our setups could be a good fit. If you're the right person to talk with, would you be open to a quick conversation? If not, I'd appreciate being pointed toward whoever handles entertainment or vendors.\n\nThanks,\n{{senderName}}\nThe Adventure Zone`,
  },
  {
    code: "past_customer_rebooking",
    name: "Past customer / rebooking",
    category: "rebooking",
    subject: "Planning {{eventName}}",
    body: `Hi {{contactName}},\n\nWe're starting to plan our upcoming season, and I'd love to talk about returning to {{eventName}}. Since we've worked together before, I don't want to make you start from scratch—I'd rather build from what worked well and anything you'd like changed this time.\n\nAre you the right person to start planning with this year?\n\nThanks,\n{{senderName}}\nThe Adventure Zone`,
  },
  {
    code: "follow_up_next_season",
    name: "Follow up next season",
    category: "follow_up",
    subject: "Following up about {{eventName}}",
    body: `Hi {{contactName}},\n\nYou asked us to check back about {{eventName}}, so I'm following up while we're planning the season. We'd still love to see whether The Adventure Zone could fit what you're putting together this year.\n\nIf your dates or plans are available, send them my way and I can take a closer look.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "package_specific_intro",
    name: "Package-specific introduction",
    category: "package",
    subject: "{{packageName}} for {{eventName}}",
    body: `Hi {{contactName}},\n\nI wanted to send a little more information about {{packageName}} for {{eventName}}. Our current starting price is {{packagePrice}} for a normal {{packageDuration}} booking, with the final setup tailored to the event and equipment availability.\n\nWe're different from a typical single-inflatable rental company: we operate as an event company, bringing the setup, teardown, staffing, and a complete attraction package.\n\nIf you'd like, I can help narrow down whether this package fits your crowd, space, and event goals.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "mini_zone_option",
    name: "Mini Zone / smaller option",
    category: "package",
    subject: "A smaller Adventure Zone option for {{eventName}}",
    body: `Hi {{contactName}},\n\nThanks for talking with us about {{eventName}}. If a full-size setup is more space or budget than you need, our Mini Zone may be worth considering. It keeps the Adventure Zone feel in a smaller five-attraction setup.\n\nThe current starting price is {{packagePrice}} for a normal {{packageDuration}} booking. Some events may also have other payment arrangements available, but those depend on the event and must be confirmed before we promise them.\n\nWould you like me to send the current Mini Zone details?\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "budget_or_space_response",
    name: "Budget or space response",
    category: "objection",
    subject: "Options for {{eventName}}",
    body: `Hi {{contactName}},\n\nThanks for letting me know. I completely understand that space and budget can shape what works for an event. We do have a smaller Mini Zone, and some events may qualify for a ticket-sales arrangement. I don't want to promise an option before we confirm the event details, but I'm happy to check what may be realistic for {{eventName}}.\n\nIf you'd like, send me the approximate available space and event dates and I'll take a look.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "wrong_contact",
    name: "Wrong contact / contact verification",
    category: "contact",
    subject: "Contact for {{eventName}}",
    body: `Hi {{contactName}},\n\nThank you for pointing me in the right direction. I've updated our contact information for {{eventName}}.\n\nI appreciate the help, and I hope the event has a great season.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "contract_attached",
    name: "Contract attached",
    category: "contract",
    subject: "Contract for {{eventName}}",
    body: `Hi {{contactName}},\n\nI'm excited that we're moving forward with {{eventName}}. I've attached the Adventure Zone contract for you to review and sign. We use our signed contract—not a vendor application—as the document that secures the booking on our calendar.\n\nPlease let me know if anything in the contract needs clarification.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "signed_contract_received",
    name: "Signed contract received",
    category: "contract",
    subject: "{{eventName}} is on our calendar",
    body: `Hi {{contactName}},\n\nThank you for sending the signed contract back. {{eventName}} is now on our calendar, and we're excited to be part of it.\n\nWho should be our on-site point of contact when we arrive, and what is the best cell number for that person? We'll also review the event details again as the date gets closer.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "deposit_received",
    name: "Deposit received",
    category: "payment",
    subject: "Deposit received for {{eventName}}",
    body: `Hi {{contactName}},\n\nJust a quick note to let you know we received the deposit for {{eventName}}. Thank you!\n\nPlease reach out anytime if questions come up before the event. We're looking forward to seeing you.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "coi_information_request",
    name: "COI information request",
    category: "insurance",
    subject: "COI information for {{eventName}}",
    body: `Hi {{contactName}},\n\nI'd be happy to request the certificate of insurance for {{eventName}}. Please send the exact legal name and mailing address for each organization that must be listed as additionally insured, along with any specific wording your city, county, venue, or organization requires.\n\nOnce I have that information, we can send it to our insurance contact for processing.\n\nThanks,\n{{senderName}}`,
  },
  {
    code: "thank_you_after_event",
    name: "Thank you after event",
    category: "relationship",
    subject: "Thank you for {{eventName}}",
    body: `Hi {{contactName}},\n\nThank you for having The Adventure Zone at {{eventName}}. We appreciate the work that goes into putting an event together and were glad to be part of it.\n\nIf you have feedback—good or bad—I'd genuinely like to hear it. The good helps us recognize what worked, and the constructive feedback helps us improve.\n\nThanks again,\n{{senderName}}\nThe Adventure Zone`,
  },
  {
    code: "holiday_message",
    name: "Holiday message",
    category: "relationship",
    subject: "Holiday wishes from The Adventure Zone",
    body: `Hi {{contactName}},\n\nWarm holiday wishes from everyone at The Adventure Zone. Thank you for your support this year. We hope the season brings you time with the people you care about and a great start to the new year.\n\nThe Adventure Zone`,
  },
];
```

Seed the convention templates (`pre_convention`, `met_at_convention`, `missed_convention`) as short variants built around the same approved package renderer; do not embed convention percentages or deadlines in static template text. Seed `ride_inspector_request` and `internal_coi_request` as `access_scope='owner'` because they are operational/internal rather than normal Office outreach.

- [ ] **Step 1: Write renderer validation tests**

Prove: unknown placeholders fail; required placeholders return `missingRequiredFields`; optional absent city/state lines collapse cleanly; package price formats as `$9,000`; duration formats as `1–4 days`; rendering does not mutate the stored template.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/communication-templates/communication-template-renderer.test.ts artifacts/api-server/src/features/communication-templates/communication-template-seed.test.ts
```

- [ ] **Step 3: Implement repository/renderer**

Use the current organization/contact/package repositories for live data. Sender identity comes from the authenticated user/account configuration, never hard-coded `Amy` or `Dave`.

- [ ] **Step 4: Seed the polished template library idempotently**

Only update a seed template automatically when its current row still matches a prior seed revision. Never overwrite an owner-edited Active template.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/communication-templates/communication-template-renderer.test.ts artifacts/api-server/src/features/communication-templates/communication-template-seed.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/communication-templates
git commit -m "feat: add reviewed communication templates"
```

---

### Task 5: Add owner template/source review APIs and settings UI

**Files:**
- Create: `artifacts/api-server/src/routes/business-sources.ts`
- Create: `artifacts/api-server/src/routes/communication-templates.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Test: `artifacts/api-server/src/routes/business-sources.test.ts`
- Test: `artifacts/api-server/src/routes/communication-templates.test.ts`
- Test: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx`

**Owner routes:**

```text
GET   /business-sources
GET   /business-sources/conflicts
PATCH /business-sources/facts/:factId { reviewState, normalizedValue? }
GET   /communication-templates
POST  /communication-templates
PATCH /communication-templates/:templateId
POST  /communication-templates/:templateId/activate
POST  /communication-templates/:templateId/archive
POST  /communication-templates/:templateId/preview
```

- [ ] **Step 1: Write strict owner API tests**

A template with `{{unknownField}}` must return 400. Activating a template with missing required metadata must return 409. Source review must never return sensitive values that were intentionally excluded from seed metadata.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/business-sources.test.ts artifacts/api-server/src/routes/communication-templates.test.ts
```

- [ ] **Step 3: Implement APIs after `requireOwnerMiddleware`**

Mount both routers after owner auth in `routes/index.ts`.

- [ ] **Step 4: Build simple settings pages**

`Settings → Business sources` shows six source records and unresolved conflicts. `Settings → Communication templates` shows Draft/Reviewed/Active/Archived, subject/body editors, placeholder buttons, preview, Activate, and Archive. Keep layouts one-column/mobile-friendly.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/business-sources.test.ts artifacts/api-server/src/routes/communication-templates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/business-sources* artifacts/api-server/src/routes/communication-templates* artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage* artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx
git commit -m "feat: add business source and template settings"
```

---

### Task 6: Let Office Coordinator render a template into a normal editable draft

**Files:**
- Create: `artifacts/api-server/src/routes/office-communication-templates.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/office-email-drafts.ts`
- Modify: `artifacts/adventure-zone/src/components/office/office-email-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx`
- Test: `artifacts/api-server/src/routes/office-communication-templates.test.ts`
- Test: `artifacts/api-server/src/routes/office-email-drafts.test.ts`
- Test: `artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx`

**Office routes:**

```text
GET  /office/communication-templates?category=...
POST /office/communication-templates/:templateId/render {
  organizationId,
  contactId,
  packageTemplateId?: string | null
}
```

Only `state='active' AND access_scope='office'` templates are returned.

- [ ] **Step 1: Write security/render tests**

Prove Office cannot list owner-only templates, cannot read source conflicts, and receives `{subject, body, missingRequiredFields, templateId}` only for Active office templates.

- [ ] **Step 2: Write draft provenance tests**

Creating a draft after rendering stores the rendered text snapshot plus nullable `communicationTemplateId`. Later template edits do not change the saved draft.

- [ ] **Step 3: Implement Office APIs before owner middleware**

Use Office auth and existing profile access checks. Do not expose raw package review notes/conflicts.

- [ ] **Step 4: Add template chooser to `OfficeEmailEditor`**

For a new email, show `Start from template` above subject. Rendering fills subject/body but leaves both freely editable. If required fields are missing, show a clear list and disable `Submit Email` until resolved; `Save Draft` remains available.

- [ ] **Step 5: Test and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/office-communication-templates.test.ts artifacts/api-server/src/routes/office-email-drafts.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx
pnpm run typecheck
git add artifacts/api-server/src/routes/office-communication-templates* artifacts/api-server/src/routes/office-email-drafts.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/components/office/office-email-editor.tsx artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx
git commit -m "feat: add office email template drafting"
```

---

### Task 7: Add selected polished objection branches to the guided call graph

**Files:**
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts`
- Modify: `artifacts/adventure-zone/src/components/calls/guided-call-script-card.tsx` only if needed for the additional response labels

**Interfaces:**

Add these node ids without changing the six script kinds:

```ts
"already_booked_response"
"space_constraint"
"budget_constraint"
"event_not_happening"
"policy_restriction"
"past_customer_feedback"
```

Use this polished visible copy:

```ts
already_booked_response.say = "Absolutely — I understand. If your plans change, we'd be glad to be considered. Would it be useful for me to check back for next season?";
space_constraint.say = "I understand. A full setup does need a fair amount of room. Would a smaller Mini Zone be worth looking at, or is space simply too tight this year?";
budget_constraint.say = "I understand. We do have a smaller Mini Zone, and some events may qualify for a ticket-sales arrangement. I don't want to promise an option before I check the event details — would you like me to see what might fit?";
event_not_happening.say = "Thanks for letting me know. Do you expect the event to return next year, or should I mark it as discontinued for now?";
policy_restriction.say = "Understood. Is that a firm venue or city restriction, or would it help if I sent our insurance and safety information for them to review?";
past_customer_feedback.say = "I'm sorry we didn't meet expectations. If you're willing, what should we know about what went wrong so I can document it properly and make sure the feedback reaches the right person?";
```

Structured outcomes:

```text
Already booked -> next season / decline this season / do not contact
Space constraint -> Mini Zone follow-up / decline this season
Budget constraint -> research payment/package options / Mini Zone follow-up / decline
Event not happening -> next season / discontinued
Policy restriction -> send insurance-safety info / firm restriction this season
Past customer feedback -> feedback/recovery note + owner follow-up / do not contact
```

- [ ] **Step 1: Write graph tests before editing copy**

Assert every new response points to a real node, every terminal branch carries the correct disposition/nextAction, and all six scripts still pass `validateGuidedCallScript`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts
```

- [ ] **Step 3: Add branches selectively**

Keep the current opening, details, package-interest, pricing, callback, and decision-maker wording unless a branch specifically requires the new response. Do not paste Amy's email-length intros into the call flow.

- [ ] **Step 4: Run script/settings regressions**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts artifacts/adventure-zone/src/pages/SettingsCallScriptsPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/features/calls/guided-call-scripts.ts artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts artifacts/adventure-zone/src/components/calls/guided-call-script-card.tsx
git commit -m "feat: expand guided call objection handling"
```

---

### Task 8: Full Phase 1 regression and source-safety verification

**Files:**
- Modify only files required by failures found in this task.

- [ ] **Step 1: Run focused source/template/package/call/Office suites**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/business-sources \
  artifacts/api-server/src/features/communication-templates \
  artifacts/api-server/src/features/packages \
  artifacts/api-server/src/routes/office-email-drafts.test.ts \
  artifacts/api-server/src/routes/office-security-regression.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run \
  artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts \
  artifacts/adventure-zone/src/pages/SettingsCallScriptsPage.test.tsx \
  artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx
```

- [ ] **Step 2: Run project typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 3: Scan seeded/public copy for forbidden raw-source leakage**

```bash
rg -n "87-3001810|15615343-003|Keeley Fitzgerald|Dana Escott|Melanie Hatch" artifacts/api-server/src/features/communication-templates artifacts/adventure-zone/src || true
```

Expected: no matches in customer-facing or Office-safe copy.

- [ ] **Step 4: Verify template/call copy does not make unconditional no-upfront promises**

```bash
rg -n "no up-front|no upfront|free to the public|percentage of.*ticket" artifacts/api-server/src/features/communication-templates artifacts/adventure-zone/src/features/calls
```

Every match must include qualifying/confirmation language or be removed.

- [ ] **Step 5: Commit any regression fixes**

```bash
git status --short
# If fixes were needed:
git add <changed-files>
git commit -m "test: harden business copy integration"
```
