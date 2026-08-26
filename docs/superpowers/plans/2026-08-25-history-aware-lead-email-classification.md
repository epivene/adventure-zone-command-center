# History-Aware Lead Email Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify each verified recipient as new, prior-outreach/no-response, returning, reintroduction, or needs-review from auditable ACT/Gmail/CRM evidence and select the correct reviewable email style.

**Architecture:** Normalize source observations into a small evidence contract, classify them with a pure deterministic policy anchored to an explicit time, and persist the result with stable evidence IDs on the lead row. Source adapters reuse existing ACT archive/external links and approved Google Workspace validation mappings; AI can suggest copy only after classification and cannot alter it.

**Tech Stack:** TypeScript, Express, PostgreSQL/Drizzle, React, Vitest, Testing Library, existing Google Workspace read client.

**Spec:** `docs/superpowers/specs/2026-08-25-act-history-aware-lead-email-design.md`

## Global Constraints

- A response is proven only by an inbound Gmail message from the verified recipient or structured ACT data explicitly identifying inbound/replied direction.
- Free-text notes are context, never automatic proof of a response.
- The cutoff is the same calendar date three years before classification; a response on the cutoff is recent.
- Outcomes are `returning_contact`, `reintroduction`, `prior_outreach_no_response`, `new_introduction`, and `needs_review`.
- Duplicate observations of the same source message count once.
- Conflicting direction, recipient, or profile matching produces `needs_review`.
- `DO NOT SEND` overrides classification before draft creation.
- AI cannot change deterministic classification or introduce unsupported claims.
- Package availability controls package sections independently.
- No Gmail send endpoint is added.

---

### Task 1: Define and test the deterministic relationship classifier

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/lead-relationship-classifier.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-relationship-classifier.test.ts`

**Interfaces:**

```ts
export type LeadRelationshipEvidence = {
  evidenceId: string;
  sourceType: "act" | "gmail" | "crm";
  sourceId: string;
  occurredAt: Date;
  direction: "inbound" | "outbound" | "unknown";
  responseProven: boolean;
  organizationId: string;
  contactId: string | null;
  recipientEmail: string | null;
  excerpt: string;
  conflicting: boolean;
};

export type LeadRelationshipOutcome =
  | "returning_contact"
  | "reintroduction"
  | "prior_outreach_no_response"
  | "new_introduction"
  | "needs_review";

export function classifyLeadRelationship(input: {
  organizationId: string;
  recipientEmail: string;
  anchor: Date;
  evidence: LeadRelationshipEvidence[];
}): {
  outcome: LeadRelationshipOutcome;
  cutoffDate: string;
  evidenceIds: string[];
  latestOutboundAt: Date | null;
  latestVerifiedResponseAt: Date | null;
  reviewRequired: boolean;
};
```

- [ ] **Step 1: Write failing boundary and safety tests**

With anchor `2026-08-25T18:00:00Z`, assert inbound on `2023-08-25` is `returning_contact`, inbound on `2023-08-24` is `reintroduction`, outbound-only is `prior_outreach_no_response`, empty evidence is `new_introduction`, and unknown/conflicting/mismatched evidence is `needs_review`. Assert duplicate `(sourceType, sourceId)` observations collapse deterministically.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-relationship-classifier.test.ts
```

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement the pure classifier**

Calculate the cutoff in UTC calendar terms without subtracting milliseconds. Normalize recipient email, reject evidence for another organization/recipient as conflicting, sort stable evidence IDs, and select the latest proven response and outbound timestamp. Never infer `responseProven` from excerpt text.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-relationship-classifier.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/lead-intake/lead-relationship-classifier.ts artifacts/api-server/src/features/lead-intake/lead-relationship-classifier.test.ts
git commit -m "feat: classify lead relationship history"
```

---

### Task 2: Assemble auditable ACT, Gmail, and CRM relationship evidence

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/lead-relationship-evidence-repository.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-relationship-evidence-repository.pglite.test.ts`
- Reuse: `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`
- Reuse: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Reuse: `artifacts/api-server/src/features/act-replacement/assignment-repository.ts`
- Reuse: `lib/db/src/schema/index.ts`

**Interfaces:**

```ts
export interface LeadRelationshipEvidenceSource {
  list(input: { organizationId: string; recipientEmail: string }): Promise<LeadRelationshipEvidence[]>;
}

export class LeadRelationshipEvidenceRepository implements LeadRelationshipEvidenceSource {
  constructor(database: DrizzleDatabase, google?: GoogleWorkspaceReadClient);
  list(input: { organizationId: string; recipientEmail: string }): Promise<LeadRelationshipEvidence[]>;
}
```

- [ ] **Step 1: Write failing repository tests**

Seed ACT activity/history detail records linked through active ACT assignments/external links, CRM activities retaining ACT source IDs, approved `google_workspace_validation_mappings`, and Google metadata returned by a fake read client. Assert: explicit ACT inbound/replied is proven; free text `talked to them` remains unknown; Gmail direction is derived from mailbox identity and verified participant address; unapproved/pending Gmail mappings are excluded; and ACT/Gmail versions of the same Gmail message deduplicate by stable source ID.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-relationship-evidence-repository.pglite.test.ts
```

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement source adapters and normalization**

Read only records linked to the requested organization. For Gmail, require an approved validation mapping and match the verified recipient against parsed From/To participants; use the existing Google Workspace connection/read client rather than a second integration. For ACT, require structured direction fields from the raw detail path; store the ACT source/version ID in `evidenceId`. For CRM, require its stable source identifier. Sanitize excerpts to a bounded single-line preview and never log them.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-relationship-evidence-repository.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/lead-intake/lead-relationship-evidence-repository.ts artifacts/api-server/src/features/lead-intake/lead-relationship-evidence-repository.pglite.test.ts
git commit -m "feat: assemble lead relationship evidence"
```

---

### Task 3: Persist classification and expose it through lead review

**Files:**
- Create: `lib/db/migrations/20260825_lead_relationship_classification.sql`
- Modify: `lib/db/src/lead-intake-schema.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/lead-review-service.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-review-service.pglite.test.ts`
- Modify: `artifacts/api-server/src/routes/lead-intake.ts`
- Test: `artifacts/api-server/src/routes/lead-intake.test.ts`

**Interfaces:**
- Add lead-row columns: `relationshipOutcome`, `relationshipAnchorAt`, `relationshipCutoffDate`, `relationshipEvidenceIds` JSONB, `latestOutboundAt`, `latestVerifiedResponseAt`, `relationshipReviewRequired`, and `relationshipClassifiedAt`.
- Add `LeadReviewService.classifyRelationship({ rowId, expectedVersion, reviewedBy, now? })`.
- Add:

```text
POST /api/lead-intake/rows/:rowId/classify-relationship
```

- [ ] **Step 1: Write failing migration/service tests**

Assert classification requires a verified row with an organization and recipient, persists the anchor/cutoff/evidence IDs atomically, increments `reviewVersion`, is idempotent for the same inputs/evidence, and returns `409` for a stale version. Assert changing recipient/profile through confirmation clears prior classification columns.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-review-service.pglite.test.ts src/routes/lead-intake.test.ts
```

Expected: FAIL because classification persistence and route are missing.

- [ ] **Step 3: Add schema/migration and service transaction**

Use check constraints for the five outcomes, an index on `(relationship_outcome, relationship_classified_at)`, and JSONB default `[]`. Lock the lead row, load normalized evidence, call `classifyLeadRelationship()`, store the result, record reviewer/time, and return the new review version.

- [ ] **Step 4: Add the route and safe error responses**

Return `422` when the lead has not completed recipient verification, `409` on version conflict, and `200` with the stored classification. Do not return raw Gmail bodies or arbitrary ACT snapshots.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-review-service.pglite.test.ts src/routes/lead-intake.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/20260825_lead_relationship_classification.sql lib/db/src/lead-intake-schema.ts artifacts/api-server/src/features/lead-intake/lead-review-service.ts artifacts/api-server/src/features/lead-intake/lead-review-service.pglite.test.ts artifacts/api-server/src/routes/lead-intake.ts artifacts/api-server/src/routes/lead-intake.test.ts
git commit -m "feat: persist lead relationship classification"
```

---

### Task 4: Display evidence and selected email style

**Files:**
- Modify: `artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.ts`
- Test: `artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.test.ts`
- Create: `artifacts/adventure-zone/src/components/lead-intake/lead-relationship-review.tsx`
- Test: `artifacts/adventure-zone/src/components/lead-intake/lead-relationship-review.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.tsx`
- Test: `artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.test.tsx`

**Interfaces:**
- Add `classifyRelationship(rowId, expectedVersion)` to the client.
- Add classification/evidence fields to `LeadImportReviewRow`.
- Map outcomes to email style keys without generating final copy:

```ts
const emailStyleByOutcome = {
  new_introduction: "new_introduction",
  prior_outreach_no_response: "prior_outreach_no_response",
  returning_contact: "returning_contact",
  reintroduction: "reintroduction",
} as const;
```

- [ ] **Step 1: Write failing UI tests**

Assert each non-review outcome shows its email style and explanation, evidence source badges/date/excerpt expanders render, organization-inbox greeting stays `Hi,`, and `needs_review` shows a blocking review state with no normal email style. Assert a changed recipient/profile hides stale classification until reclassified.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake/lead-intake-client.test.ts src/components/lead-intake/lead-relationship-review.test.tsx src/components/lead-intake/lead-contact-date-review.test.tsx --maxWorkers=1
```

Expected: FAIL because relationship review does not exist.

- [ ] **Step 3: Implement client and review component**

Keep the UI in three sections: Profile and recipient evidence, Previous contact, and Email style. Use explanations such as `Returning contact: verified reply on May 14, 2025.` derived from stored timestamps. Do not expose raw message bodies.

- [ ] **Step 4: Run focused tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake/lead-intake-client.test.ts src/components/lead-intake/lead-relationship-review.test.tsx src/components/lead-intake/lead-contact-date-review.test.tsx --maxWorkers=1
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.ts artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.test.ts artifacts/adventure-zone/src/components/lead-intake/lead-relationship-review.tsx artifacts/adventure-zone/src/components/lead-intake/lead-relationship-review.test.tsx artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.tsx artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.test.tsx
git commit -m "feat: review relationship-aware email style"
```

---

### Task 5: Enforce the classification at email rendering boundaries

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/lead-email-style-policy.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-email-style-policy.test.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/lead-email-renderer.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-email-renderer.test.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/draft-readiness-policy.ts`
- Test: `artifacts/api-server/src/features/lead-intake/draft-readiness-policy.test.ts`
- Modify: `artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.tsx`
- Test: `artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.test.tsx`

**Dependency:** Execute this task after Task 7 of `docs/superpowers/plans/2026-08-25-excel-leads-personalized-gmail-drafts.md` has created the renderer, readiness policy, preview, communication-block policy, and approved introduction template.

**Interfaces:**

```ts
export function selectLeadEmailStyle(input: {
  outcome: LeadRelationshipOutcome;
  doNotSend: boolean;
  availabilityReady: boolean;
}): { allowed: true; style: Exclude<LeadRelationshipOutcome, "needs_review"> }
  | { allowed: false; reason: "do_not_send" | "relationship_needs_review" | "availability_not_ready" };
```

- [ ] **Step 1: Write failing policy tests**

Assert `DO NOT SEND` blocks all outcomes, `needs_review` blocks normal preview/draft creation, missing availability blocks all styles, and each allowed outcome returns only its matching style. Add a test proving caller-supplied AI text cannot change `outcome` or `style`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-email-style-policy.test.ts
```

Expected: FAIL because the policy module is missing.

- [ ] **Step 3: Implement the pure policy and wire the existing preview/draft boundary**

Evaluate `doNotSend` first, relationship review second, and availability third. Select only versioned approved templates. Keep final returning/reintroduction/prior-outreach wording disabled until Amy approves those template versions; report `template_not_approved` from the preview service rather than falling back to introduction copy.

- [ ] **Step 4: Run safety tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-email-style-policy.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS. Also run the renderer, readiness-policy, and preview tests named above, and verify no Gmail send method was added.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/lead-intake/lead-email-style-policy.ts artifacts/api-server/src/features/lead-intake/lead-email-style-policy.test.ts artifacts/api-server/src/features/lead-intake/lead-email-renderer.ts artifacts/api-server/src/features/lead-intake/lead-email-renderer.test.ts artifacts/api-server/src/features/lead-intake/draft-readiness-policy.ts artifacts/api-server/src/features/lead-intake/draft-readiness-policy.test.ts artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.tsx artifacts/adventure-zone/src/components/lead-intake/lead-email-preview.test.tsx
git commit -m "feat: gate lead email styles by relationship"
```

---

### Task 6: Verify the complete history-aware checkpoint

**Files:**
- Modify only if verification exposes a defect in files already named above.

**Interfaces:**
- No new interface; verify the integrated classifier and safety gates.

- [ ] **Step 1: Run focused backend and frontend regression suites**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake src/routes/lead-intake.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake src/components/lead-intake --maxWorkers=1
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 2: Perform live acceptance testing after deployment**

Use four controlled profiles/recipients representing recent inbound response, older inbound response, outbound-only, and no history. Confirm the app selects returning, reintroduction, prior-outreach/no-response, and introduction respectively. Use one ambiguous case and confirm no normal draft is offered. Confirm a DO NOT SEND record remains blocked.

- [ ] **Step 3: Commit verification-only fixes, if any**

```bash
git add artifacts/api-server/src/features/lead-intake artifacts/api-server/src/routes/lead-intake.ts artifacts/adventure-zone/src/features/lead-intake artifacts/adventure-zone/src/components/lead-intake lib/db/src/lead-intake-schema.ts lib/db/migrations/20260825_lead_relationship_classification.sql
git commit -m "fix: close history-aware email verification gaps"
```

Skip this commit when verification required no code changes.
