# Google Workspace Matching, AI Assistance, and Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Match approved Gmail threads, files, and Google Calendar events to the correct CRM records using deterministic evidence, use AI only for bounded categorization and fact suggestions, and give the owner and Office Coordinator a complete review workflow for anything uncertain.

**Architecture:** Add an auditable matching layer between the durable Google archive and CRM records. Deterministic rules are evaluated first and are the only authority for automatic links; AI receives only approved business content and a bounded candidate list, then returns validated categorization, summaries, extracted facts, and candidate ordering. Uncertain ownership, profile conflicts, and extracted facts are stored as durable review items that can be resolved by either the owner or Office Coordinator without exposing Google content to leg managers.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, Zod, existing provider-agnostic `AiCompletionClient`, React/Vite/Wouter, TanStack Query, Vitest, PGlite, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

**Depends on:**
- `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-gmail-files-backfill.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-calendar-sync.md`

## Global Constraints

- Deterministic evidence is authoritative; AI is never the sole authority for ownership.
- Automatic links require one unique high-confidence result with no contradictory evidence.
- Exact saved contact email, an approved exact domain, an existing approved source link, or an exact booking identity/date/location combination may support automatic linking.
- Public email domains such as Gmail, Yahoo, Outlook, Hotmail, AOL, iCloud, and Proton do not establish organization ownership.
- AI may categorize, summarize, extract possible facts, and rank only candidates supplied by deterministic search.
- AI may not invent a profile ID, contact, booking, event date, amount, or relationship.
- AI failure must not block deterministic archiving or matching.
- Existing nonblank CRM fields are never silently overwritten.
- Extracted facts are suggestions with source evidence and require explicit acceptance.
- Reusable matching rules are visible, reversible, attributable, and exact—not fuzzy hidden memory.
- Internal filing areas are `employee`, `receipt`, and `association`; event/profile linking remains optional when clear evidence also exists.
- Owner and Office Coordinator may review approved business records.
- Office Coordinator may approve factual profile/contact/booking suggestions allowed by the existing Office permission model, but cannot change sales priority, route assignment, probability, finance, crew, or private owner metadata.
- Leg managers receive no Google message, file, Calendar, review, suggestion, or matching-rule endpoint.
- Every source reaches a visible outcome; there is no hidden unlinked bucket.

---

### Task 1: Add matching, rule, analysis, and suggestion schema

**Files:**
- Create: `lib/db/src/google-workspace-matching-schema.ts`
- Create: `lib/db/migrations/20260822_google_workspace_matching_review.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-matching-schema-contract.test.ts`

**Tables:**

```text
google_workspace_match_rules
  id uuid PK
  connection_id uuid NOT NULL -> connections ON DELETE CASCADE
  rule_type text NOT NULL CHECK email_contact|domain_organization|thread_target|calendar_pattern
  normalized_key text NOT NULL
  target_type text NOT NULL CHECK organization|contact|booking|internal_area
  target_id text NOT NULL
  internal_area text CHECK employee|receipt|association
  active boolean NOT NULL default true
  authority text NOT NULL CHECK deterministic|owner_review|office_review
  created_by text NOT NULL
  superseded_at timestamptz
  superseded_by uuid
  created_at / updated_at
  UNIQUE(connection_id,rule_type,normalized_key) WHERE active=true

google_workspace_match_candidates
  id uuid PK
  source_type text NOT NULL CHECK thread|file|calendar_event
  source_id uuid NOT NULL
  target_type text NOT NULL CHECK organization|contact|booking|internal_area
  target_id text NOT NULL
  confidence text NOT NULL CHECK high|medium|low
  deterministic_score integer NOT NULL CHECK 0..100
  evidence jsonb NOT NULL CHECK array
  contradictory_evidence jsonb NOT NULL CHECK array
  ai_rank integer
  ai_rationale text
  created_at / updated_at
  UNIQUE(source_type,source_id,target_type,target_id)

google_workspace_review_items
  id uuid PK
  source_type text NOT NULL CHECK thread|file|calendar_event|profile_suggestion
  source_id uuid NOT NULL
  reason text NOT NULL CHECK ambiguous_match|conflicting_evidence|new_contact|profile_fact|file_unavailable|retry_required
  status text NOT NULL CHECK pending|resolved|ignored
  assigned_target_type text CHECK organization|contact|booking|internal_area
  assigned_target_id text
  resolution text
  resolved_by_kind text CHECK owner|office
  resolved_by_id text
  resolved_at timestamptz
  created_at / updated_at
  UNIQUE(source_type,source_id,reason) WHERE status='pending'

google_workspace_thread_analyses
  id uuid PK
  thread_id uuid NOT NULL -> gmail_threads ON DELETE CASCADE
  analysis_version integer NOT NULL
  provider_name text
  category text NOT NULL CHECK promo_brochures|direct_contact|quote_pricing|contract|invoice_payment|vendor_application|event_logistics|association|employee|receipt|general_business
  summary text NOT NULL
  tags jsonb NOT NULL CHECK array
  extracted_facts jsonb NOT NULL CHECK array
  candidate_ranking jsonb NOT NULL CHECK array
  source_fingerprint text NOT NULL
  state text NOT NULL CHECK complete|ai_unavailable|invalid_output
  last_error_code text
  created_at / updated_at
  UNIQUE(thread_id,analysis_version,source_fingerprint)

google_workspace_profile_suggestions
  id uuid PK
  source_type text NOT NULL CHECK thread|file|calendar_event
  source_id uuid NOT NULL
  target_type text NOT NULL CHECK organization|contact|booking
  target_id uuid NOT NULL
  field_name text NOT NULL
  current_value text
  suggested_value text NOT NULL
  confidence text NOT NULL CHECK high|medium|low
  rationale text NOT NULL
  evidence_excerpt text NOT NULL
  evidence_metadata jsonb NOT NULL
  status text NOT NULL CHECK pending|accepted|rejected|stale
  created_by text NOT NULL CHECK ai|deterministic
  reviewed_by_kind text CHECK owner|office
  reviewed_by_id text
  reviewed_at timestamptz
  created_at / updated_at
  UNIQUE(source_type,source_id,target_type,target_id,field_name,suggested_value)
```

Add `category`, `category_origin`, `summary`, and `tags` projection columns to `google_workspace_gmail_threads` only if query performance requires them; otherwise query the latest analysis through a view. Prefer a view to duplicated state.

- [ ] **Step 1: Write the schema contract test**

Assert active-rule uniqueness, review resolution pair consistency, candidate evidence arrays, AI analysis state/category checks, suggestion review consistency, and that polymorphic target IDs are always validated by repository code.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/google-matching-schema-contract.test.ts
```

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement SQL, Drizzle exports, and required startup DDL**

Add indexes for pending review order, source candidate lookup, active rule lookup, pending suggestion target/field, and latest thread analysis. Required startup DDL must touch only the Google Workspace tables created by prior phases.

- [ ] **Step 4: Run/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/google-matching-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/google-workspace-matching-schema.ts lib/db/migrations/20260822_google_workspace_matching_review.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/db/google-workspace-startup-migration.ts artifacts/api-server/src/features/google-workspace/matching/google-matching-schema-contract.test.ts
git commit -m "feat: add Google matching and review schema"
```

---

### Task 2: Normalize business evidence and add the public-domain guard

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/matching/business-evidence.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/business-evidence.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/public-email-domains.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/public-email-domains.test.ts`

**Interfaces:**

```ts
export type NormalizedMailbox = {
  address: string;
  localPart: string;
  domain: string;
  publicDomain: boolean;
};

export function normalizeMailbox(value: string): NormalizedMailbox | null;
export function normalizeBusinessName(value: string): string;
export function normalizePhoneEvidence(value: string): string | null;
export function normalizeBusinessDate(value: Date | string): string | null;
export function normalizeAddressEvidence(input: {
  address1?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}): string;
export function isPublicEmailDomain(domain: string): boolean;
```

- [ ] **Step 1: Write normalization tests**

Cover mixed case, display-name email strings, plus-addressing, Unicode/invalid addresses, punctuation in organization names, North American phone extensions, business-date normalization, and these public domains at minimum:

```text
gmail.com, googlemail.com, yahoo.com, outlook.com, hotmail.com,
live.com, msn.com, aol.com, icloud.com, me.com, proton.me, protonmail.com
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/business-evidence.test.ts src/features/google-workspace/matching/public-email-domains.test.ts
```

- [ ] **Step 3: Implement pure deterministic helpers**

Keep these functions free of database and AI dependencies. A public domain may still support an exact saved-contact match; it may not support domain-to-organization inference.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/business-evidence.test.ts src/features/google-workspace/matching/public-email-domains.test.ts
git add artifacts/api-server/src/features/google-workspace/matching/business-evidence* artifacts/api-server/src/features/google-workspace/matching/public-email-domains*
git commit -m "feat: normalize deterministic Google matching evidence"
```

---

### Task 3: Implement reusable exact matching rules

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-rule-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-rule-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-rule-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-rule-service.test.ts`

**Interfaces:**

```ts
export type GoogleMatchRuleType =
  | "email_contact"
  | "domain_organization"
  | "thread_target"
  | "calendar_pattern";

export type GoogleMatchRuleView = {
  id: string;
  type: GoogleMatchRuleType;
  key: string;
  target: { type: "organization" | "contact" | "booking" | "internal_area"; id: string };
  authority: "deterministic" | "owner_review" | "office_review";
  createdBy: string;
  active: boolean;
  createdAt: string;
};

export interface GoogleMatchRuleService {
  find(input: { connectionId: string; type: GoogleMatchRuleType; key: string }): Promise<GoogleMatchRuleView | null>;
  create(input: {
    connectionId: string;
    type: GoogleMatchRuleType;
    key: string;
    targetType: GoogleMatchRuleView["target"]["type"];
    targetId: string;
    actorKind: "owner" | "office";
    actorId: string;
  }): Promise<GoogleMatchRuleView>;
  deactivate(input: { ruleId: string; actorKind: "owner" | "office"; actorId: string }): Promise<void>;
}
```

- [ ] **Step 1: Write repository/service tests**

Prove exact normalized keys, target existence checks, public-domain organization rule rejection, case-insensitive email/domain lookup, active-rule replacement with supersession metadata, idempotent replay, and audit events.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/google-match-rule-repository.pglite.test.ts src/features/google-workspace/matching/google-match-rule-service.test.ts
```

- [ ] **Step 3: Implement allowlisted rule creation**

`email_contact` must target a contact. `domain_organization` must target an organization and reject public domains. `thread_target` may target organization, contact, booking, or an internal area. `calendar_pattern` may target organization or booking but never auto-apply without another agreeing signal.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/google-match-rule-repository.pglite.test.ts src/features/google-workspace/matching/google-match-rule-service.test.ts
git add artifacts/api-server/src/features/google-workspace/matching/google-match-rule-*
git commit -m "feat: add auditable exact Google matching rules"
```

---

### Task 4: Build the deterministic Gmail thread matcher

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/matching/gmail-thread-matcher.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/gmail-thread-matcher.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-candidate-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-match-candidate-repository.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/matching/google-content-link-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/matching/google-content-link-repository.pglite.test.ts`

**Interfaces:**

```ts
export type MatchEvidenceCode =
  | "existing_approved_rule"
  | "exact_contact_email"
  | "exact_unique_business_domain"
  | "exact_booking_name_date_venue"
  | "exact_booking_contact_date"
  | "exact_phone"
  | "exact_address";

export type GmailThreadMatchDecision =
  | {
      kind: "connected";
      links: Array<{
        targetType: "organization" | "contact" | "booking";
        targetId: string;
        evidence: Array<{ code: MatchEvidenceCode; value: string }>;
      }>;
    }
  | {
      kind: "internal_filing";
      area: "employee" | "receipt" | "association";
      optionalLinks: Array<{ targetType: "organization" | "booking"; targetId: string }>;
    }
  | {
      kind: "awaiting_match";
      candidates: GoogleMatchCandidate[];
    }
  | {
      kind: "conflict";
      candidates: GoogleMatchCandidate[];
      contradictionCodes: string[];
    };

export class GmailThreadMatcher {
  match(threadId: string): Promise<GmailThreadMatchDecision>;
}
```

- [ ] **Step 1: Write end-to-end deterministic matching tests**

Required cases:

1. Exact saved contact email with one active organization membership connects contact and organization.
2. Exact contact email with two active organization memberships yields review candidates.
3. Exact unique nonpublic domain with an approved domain rule connects organization.
4. Public Gmail address with no saved contact remains unmatched.
5. Exact thread-target rule wins unless a contradictory exact contact exists; contradiction creates conflict.
6. Receipts root files to `receipt`; an exact event booking may also be an optional link.
7. Employee root files to `employee` and never auto-links to an event based only on a name in the body.
8. Exact booking name/date/venue uniquely agrees and connects booking plus organization.
9. Two same-name bookings in different cities remain awaiting match.
10. A second matcher run adds no duplicate candidates or links.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/gmail-thread-matcher.pglite.test.ts src/features/google-workspace/matching/google-match-candidate-repository.pglite.test.ts src/features/google-workspace/matching/google-content-link-repository.pglite.test.ts
```

- [ ] **Step 3: Implement documented scoring without fuzzy ownership**

Use these deterministic scores:

```text
existing approved exact rule                         100
exact saved contact email                             95
exact unique approved business domain                 85
exact booking name + dates + venue/city               90
exact booking contact + dates                         90
exact normalized phone                                70
exact normalized address                              65
```

Automatic linking requires at least one score of 85 or greater, a unique winning target, and no contradictory exact evidence. Lower evidence creates candidates only.

- [ ] **Step 4: Persist decision transactionally**

Replace current candidates for the source, insert links only for connected decisions, set review state for awaiting/conflict, preserve internal filing, and write an audit event.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/gmail-thread-matcher.pglite.test.ts src/features/google-workspace/matching/google-match-candidate-repository.pglite.test.ts src/features/google-workspace/matching/google-content-link-repository.pglite.test.ts
git add artifacts/api-server/src/features/google-workspace/matching/gmail-thread-matcher* artifacts/api-server/src/features/google-workspace/matching/google-match-candidate-repository* artifacts/api-server/src/features/google-workspace/matching/google-content-link-repository*
git commit -m "feat: match Gmail threads with exact CRM evidence"
```

---

### Task 5: Add bounded AI categorization and fact extraction

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-types.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-prompt.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-prompt.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-service.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/ai/google-thread-analysis-repository.pglite.test.ts`

**Interfaces:**

```ts
export const googleThreadCategorySchema = z.enum([
  "promo_brochures",
  "direct_contact",
  "quote_pricing",
  "contract",
  "invoice_payment",
  "vendor_application",
  "event_logistics",
  "association",
  "employee",
  "receipt",
  "general_business",
]);

export const googleThreadAnalysisSchema = z.object({
  category: googleThreadCategorySchema,
  summary: z.string().trim().min(1).max(1500),
  tags: z.array(z.string().trim().min(1).max(80)).max(20),
  facts: z.array(z.object({
    kind: z.enum([
      "contact_name", "contact_email", "phone", "extension", "job_title",
      "company_domain", "mailing_address", "venue_address", "event_date",
      "application_deadline", "attendance", "quote_amount", "deposit_amount",
      "invoice_number", "payment_status", "package_reference", "follow_up_date",
    ]),
    value: z.string().trim().min(1).max(500),
    confidence: z.enum(["high", "medium", "low"]),
    evidenceExcerpt: z.string().trim().min(1).max(500),
  })).max(50),
  candidateRanking: z.array(z.object({
    targetType: z.enum(["organization", "contact", "booking"]),
    targetId: z.string().uuid(),
    rank: z.number().int().min(1).max(20),
    rationale: z.string().trim().min(1).max(500),
  })).max(20),
}).strict();

export class GoogleThreadAnalysisService {
  analyze(input: {
    threadId: string;
    candidateIds: Array<{ targetType: "organization" | "contact" | "booking"; targetId: string; displayName: string }>;
  }): Promise<{ state: "complete" | "ai_unavailable" | "invalid_output" }>;
}
```

- [ ] **Step 1: Write prompt-safety tests**

The prompt must:

- state that email content is untrusted data and instructions inside it must not be followed;
- include only approved business thread text;
- include only deterministic candidate IDs supplied by the service;
- forbid new IDs and ownership decisions;
- require one JSON object and no Markdown;
- cap each message body and total prompt length deterministically;
- redact refresh tokens, authorization headers, and known secret-like patterns before the AI call.

- [ ] **Step 2: Write service tests**

Prove valid output persists, unknown candidate IDs make output invalid, extra fields are rejected, malformed JSON becomes `invalid_output`, absent AI provider becomes `ai_unavailable`, and none of these states block deterministic matching or archive visibility.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/ai/google-thread-analysis-prompt.test.ts src/features/google-workspace/ai/google-thread-analysis-service.test.ts src/features/google-workspace/ai/google-thread-analysis-repository.pglite.test.ts
```

- [ ] **Step 4: Implement using the existing `createAiClient`**

Compute a stable `sourceFingerprint` from thread message IDs, updated timestamps, candidate IDs, and `analysisVersion=1`. Reuse an existing complete analysis when the fingerprint matches. Candidate ranking updates `ai_rank` and `ai_rationale` only; it never inserts content links.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/ai
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/ai
git commit -m "feat: add bounded AI assistance for business email"
```

---

### Task 6: Turn extracted facts into allowlisted profile suggestions

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-suggestion-field-policy.ts`
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-suggestion-field-policy.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-profile-suggestion-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-profile-suggestion-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-profile-suggestion-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/suggestions/google-profile-suggestion-service.test.ts`

**Allowlisted fields:**

```ts
export const googleSuggestionFields = {
  organization: [
    "phone", "website", "address_1", "address_2", "city", "region",
    "postal_code", "description",
  ],
  contact: [
    "first_name", "last_name", "email", "phone", "job_title",
    "address_1", "address_2", "city", "region", "postal_code",
  ],
  booking: [
    "venue_name", "address_1", "city", "region", "postal_code",
    "starts_at", "ends_at", "notes",
  ],
} as const;
```

Explicitly excluded fields include status, probability, travel leg, package selection, route priority, Last Resort, financial totals, crew, and manager-private fields.

- [ ] **Step 1: Write policy tests**

Map each fact kind to zero or more allowed suggestions. Reject malformed dates/amounts, ignore facts without a linked target, cap evidence excerpts, and mark a suggestion stale when the target field changed after suggestion creation.

- [ ] **Step 2: Write acceptance transaction tests**

Accepting a pending suggestion must:

1. lock the suggestion and target row;
2. verify current value still equals the stored snapshot;
3. update only the allowlisted physical column;
4. record reviewer and audit event;
5. mark competing pending suggestions for the same field stale.

If the value changed, return `GOOGLE_SUGGESTION_TARGET_CHANGED` and make no write. Replaying an already accepted/rejected suggestion is idempotent.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/suggestions/google-suggestion-field-policy.test.ts src/features/google-workspace/suggestions/google-profile-suggestion-repository.pglite.test.ts src/features/google-workspace/suggestions/google-profile-suggestion-service.test.ts
```

- [ ] **Step 4: Implement generation and review-safe application**

Blank current fields still require explicit acceptance. Suggestions created by deterministic parsing and AI share the same policy and evidence requirements.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/suggestions
git add artifacts/api-server/src/features/google-workspace/suggestions
git commit -m "feat: create auditable Google profile suggestions"
```

---

### Task 7: Add shared review service and owner/Office APIs

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/review/google-review-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/review/google-review-service.pglite.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-review.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-review.test.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-review.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-review.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Owner routes:**

```text
GET    /google-workspace/review?kind=matches|suggestions|files&page=1&pageSize=50
GET    /google-workspace/rules
POST   /google-workspace/review/:reviewId/assign
POST   /google-workspace/review/:reviewId/internal-area
POST   /google-workspace/review/:reviewId/ignore
POST   /google-workspace/review/:reviewId/retry
POST   /google-workspace/suggestions/:suggestionId/accept
POST   /google-workspace/suggestions/:suggestionId/reject
DELETE /google-workspace/rules/:ruleId
```

**Office routes:**

```text
GET  /office/google-workspace/review?kind=matches|suggestions|files&page=1&pageSize=50
GET  /office/google-workspace/rules
POST /office/google-workspace/review/:reviewId/assign
POST /office/google-workspace/review/:reviewId/internal-area
POST /office/google-workspace/review/:reviewId/ignore
POST /office/google-workspace/review/:reviewId/retry
POST /office/google-workspace/suggestions/:suggestionId/accept
POST /office/google-workspace/suggestions/:suggestionId/reject
```

Office cannot delete owner-created rules or access connection/scope settings. Assignment payload may include `saveRule: true`; the service creates only the exact rule type supported by the reviewed evidence.

- [ ] **Step 1: Write shared-service tests**

Cover assignment to organization/contact/booking, internal filing, explicit ignore, file retry, suggestion acceptance/rejection, optional exact rule creation, target version conflicts, and audit attribution.

- [ ] **Step 2: Write role-boundary route tests**

Owner and Office receive approved business records. Office receives no token/scope settings and cannot delete rules. Leg-manager token fails on every endpoint. Anonymous requests fail. Crafted fields such as `probability`, `ownerSortOrder`, `travelLegId`, or arbitrary rule type return 400.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/review/google-review-service.pglite.test.ts src/routes/google-workspace-review.test.ts src/routes/office-google-workspace-review.test.ts
```

- [ ] **Step 4: Implement separate mounts over one policy service**

Mount Office routes before owner middleware with `createRequireOfficeMiddleware`. Mount owner routes after `requireOwnerMiddleware`. Never accept a leg-manager context in the shared service.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/review src/routes/google-workspace-review.test.ts src/routes/office-google-workspace-review.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/review artifacts/api-server/src/routes/google-workspace-review* artifacts/api-server/src/routes/office-google-workspace-review* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add owner and Office Google review APIs"
```

---

### Task 8: Run matching and AI as restart-safe worker stages

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-analysis-worker.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-analysis-worker.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-sync-repository.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Stage order:**

```text
archive thread/event/file
→ deterministic match
→ persist connected/internal/review outcome
→ AI analysis when enabled and useful
→ suggestion generation
→ terminal item state
```

- [ ] **Step 1: Write worker orchestration tests**

Prove deterministic match always runs before AI, already-connected items can still receive categorization/suggestions, AI unavailable is nonfatal, one thread analysis failure does not block other items, and retrying the same item does not duplicate links, candidates, analyses, or suggestions.

- [ ] **Step 2: Add feature switch tests**

`GOOGLE_WORKSPACE_AI_ENABLED=false` skips the AI call while deterministic matching and terminal classification continue. Missing variable defaults to false until explicitly enabled during rollout.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync/google-backfill-worker.test.ts src/features/google-workspace/sync/google-analysis-worker.test.ts
```

- [ ] **Step 4: Implement bounded worker claims**

Use separate item kinds/stages so expensive analysis does not hold a Gmail discovery lease. Start/close the analysis loop with the existing Google runtime and application shutdown.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync
git add artifacts/api-server/src/features/google-workspace/sync artifacts/api-server/src/index.ts
git commit -m "feat: process Google matching and AI stages"
```

---

### Task 9: Build owner and Office review workspaces

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-review-types.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-match-review-card.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-match-review-card.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-suggestion-review-card.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-suggestion-review-card.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-file-review-card.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-file-review-card.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceReviewPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/GoogleWorkspaceReviewPage.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeGoogleWorkspaceReviewPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: `artifacts/adventure-zone/src/components/office/office-shell.tsx`

- [ ] **Step 1: Write UI tests**

Match cards show source type, participants/title/date, deterministic evidence, contradiction warnings, candidate profiles, AI ranking explicitly labeled `AI suggestion`, and assign/internal/ignore/retry actions. Suggestion cards show current value, proposed value, source excerpt, confidence, and accept/reject. File cards show original link and safe error.

- [ ] **Step 2: Write Office-specific access/copy tests**

Office UI has review and profile links but no Connect Google, Scope, Disconnect, token, or rule-delete controls. It uses `officeGet/officePost`. Owner UI uses owner API helpers.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/google-match-review-card.test.tsx src/components/google-workspace/google-suggestion-review-card.test.tsx src/components/google-workspace/google-file-review-card.test.tsx src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx
```

- [ ] **Step 4: Implement routes and navigation**

```tsx
<Route path="/google-workspace/review" component={GoogleWorkspaceReviewPage} />
<Route path="/office/google-workspace/review" component={OfficeGoogleWorkspaceReviewPage} />
```

Add `Google review` under owner Imports & Data and Office Booking Workspace navigation. Do not add any manager route/menu entry.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/GoogleWorkspaceReviewPage* artifacts/adventure-zone/src/pages/OfficeGoogleWorkspaceReviewPage* artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx artifacts/adventure-zone/src/components/office/office-shell.tsx
git commit -m "feat: add Google matching and suggestion review UI"
```

---

### Task 10: Add matching, AI, suggestion, and access E2E gates

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-matching-review.e2e.pglite.test.ts`
- Modify: `.github/workflows/google-workspace-sync-ci.yml`

- [ ] **Step 1: Seed a comprehensive E2E fixture**

Include:

- exact contact email and one organization;
- ambiguous contact membership;
- public-domain unmatched thread;
- approved private-domain rule;
- exact booking name/date/venue;
- employee and receipt internal threads;
- AI output containing one valid category, two facts, valid bounded ranking;
- malicious email text asking the AI to ignore instructions;
- stale suggestion target update;
- owner and Office review actors;
- leg-manager token.

Run archive matching and analysis twice.

Expected assertions:

```ts
expect(await automaticLinks()).toEqual(expectedExactLinks);
expect(await aiOnlyLinks()).toHaveLength(0);
expect(await pendingAmbiguousReview()).toHaveLength(1);
expect(await duplicateLinkCount()).toBe(0);
expect(await duplicateSuggestionCount()).toBe(0);
expect(await legManagerGoogleResponses()).toEqual(expect.arrayContaining([401, 404]));
```

- [ ] **Step 2: Add all phase paths to CI**

Run matching, AI, suggestions, review services/routes, owner/Office frontend review pages, API build, and frontend build.

- [ ] **Step 3: Run full phase verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching src/features/google-workspace/ai src/features/google-workspace/suggestions src/features/google-workspace/review src/routes/google-workspace-review.test.ts src/routes/office-google-workspace-review.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/matching/google-matching-review.e2e.pglite.test.ts .github/workflows/google-workspace-sync-ci.yml
git commit -m "test: verify Google matching AI and review safety"
```

## Phase Acceptance

- Exact deterministic evidence automatically links only unique nonconflicting records.
- Public domains and ambiguous identities never create organization links by themselves.
- Employees, Business Receipts, and Associations remain distinct internal areas.
- AI categorizes, summarizes, extracts facts, and ranks bounded candidates without creating ownership links.
- AI unavailability or invalid output does not block archiving or deterministic matching.
- Profile facts are durable suggestions and never silent overwrites.
- Owner and Office Coordinator can resolve matches, internal filing, unavailable files, and suggestions with a complete audit trail.
- Reusable exact rules are visible and reversible.
- Office permissions remain factual and bounded; owner-private fields remain inaccessible.
- Leg managers cannot access any Google content or review endpoint.
- Re-running matching and analysis creates no duplicate links, rules, candidates, analyses, or suggestions.
