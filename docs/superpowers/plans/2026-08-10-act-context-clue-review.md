# Act Context-Clue Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Act import's manual-review queue by automatically resolving only records for which two independent, non-conflicting clue families identify one compatible local or archived parent record, while preserving unsupported source data and never overwriting a populated local field without explicit review.

**Architecture:** Add a pure deterministic clue resolver and structured evidence to the existing Act replacement matcher result. Build a bounded in-memory context index once per organizer run, resolve canonical company/contact/booking identities first, then replay dependent timeline and relationship records against those resolved identities. Persist sanitized evidence in the existing outcome `match` JSON, project it through the review API, and extend existing bounded bulk decisions for remaining homogeneous duplicate choices. No database migration is required.

**Tech Stack:** TypeScript, Node.js, Drizzle ORM/PostgreSQL, Express/Zod, React, Vitest, Testing Library, pnpm.

## Global Constraints

- A non-authoritative automatic match requires at least two independent clue families; multiple values from one family count once.
- Existing valid Act links, version-matched manual assignments, and version/fingerprint-matched review decisions remain authoritative.
- Any tie, incompatible entity type, contradictory clue, shared mailbox/shared phone-only evidence, fuzzy narrative-only evidence, or unresolved dependency remains manual review.
- Automatic operations may create records, create relationships, or fill empty fields. They must never overwrite a populated differing local field.
- Unknown/custom fields remain archived and diagnostic; they do not block supported core fields from importing.
- Narrative evidence must be exact normalized token/phrase evidence from allowlisted display fields. Do not log or expose full note/history bodies.
- Indexes and resolver outputs must be deterministically sorted and bounded; do not add per-card assignment-target requests or quadratic all-to-all scans.
- Rebuild from the saved archive only. Do not refetch Act.

---

## Task 1: Add structured clue evidence and the pure resolver

**Files:**

- Create: `artifacts/api-server/src/features/act-replacement/matching/context-clue-resolver.ts`
- Create: `artifacts/api-server/src/features/act-replacement/matching/context-clue-resolver.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/matching/match-result.ts`

- [ ] Write failing tests for these resolver outcomes:
  - one clue family returns `none`;
  - two families pointing to one compatible target return `resolved`;
  - two values from the same family still return `none`;
  - a tie across targets returns `ambiguous` with sorted IDs;
  - contradictory strong clues return `ambiguous` even when one target has two positive clues;
  - authoritative evidence resolves directly and is labeled authoritative;
  - candidate ordering does not affect output.
- [ ] Run `pnpm --filter @workspace/api-server test -- matching/context-clue-resolver.test.ts` and verify the new tests fail because the module/types do not exist.
- [ ] Add these exact public types:

  ```ts
  export type ContextClueFamily =
    | "identity"
    | "direct_contact"
    | "web_identity"
    | "location"
    | "archive_relationship"
    | "event_context"
    | "narrative_context";

  export type ContextClueEvidence = {
    family: ContextClueFamily;
    label: string;
    targetEntityType: "organization" | "contact" | "booking" | "calling_list" | "activity";
    targetEntityId: string;
    authority: "authoritative" | "supporting";
  };

  export type ContextResolution =
    | { kind: "resolved"; targetEntityType: ContextClueEvidence["targetEntityType"]; targetEntityId: string; reason: string; evidence: ContextClueEvidence[] }
    | { kind: "none"; reason: string; evidence: ContextClueEvidence[] }
    | { kind: "ambiguous"; candidateIds: string[]; reason: string; evidence: ContextClueEvidence[] };
  ```
- [ ] Implement `resolveContextClues(clues)` as a pure function that deduplicates by family and target, gives authoritative evidence precedence only when it identifies exactly one target, requires two supporting families otherwise, rejects ties/conflicts, and returns stable sorted evidence.
- [ ] Extend `MatchResult` exact and ambiguous variants with optional sanitized `evidence?: ContextClueEvidence[]`; preserve all existing callers by keeping the property optional.
- [ ] Run the focused resolver test and `pnpm --filter @workspace/api-server run typecheck`.
- [ ] Commit: `feat(act-import): add deterministic context clue resolver`

## Task 2: Make canonical identity matchers obey the two-family rule

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/matching/organization-matcher.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/matching/contact-matcher.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/matching/booking-matcher.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/matching/matchers.test.ts`

- [ ] Replace the current contact tests that accept email-only or phone-only automatic matches with failing tests requiring compatible normalized name plus unique email/phone, or compatible normalized name plus a resolved organization relationship.
- [ ] Add failing tests proving shared mailbox, shared phone, name-only, conflicting email/phone, and organization disagreement remain ambiguous/manual.
- [ ] Add failing tests that organization matching emits independent evidence families (`identity`, `direct_contact`, `web_identity`, `location`) and never counts city plus postal code as two families.
- [ ] Add failing booking tests requiring the already-resolved organization plus exact booking name/date or exact event location/date, with conflicts remaining manual.
- [ ] Run `pnpm --filter @workspace/api-server test -- matching/matchers.test.ts` and confirm the changed expectations fail.
- [ ] Refactor each matcher to build `ContextClueEvidence[]` and delegate the final decision to `resolveContextClues`; retain authoritative manual assignment/external-link behavior.
- [ ] Add `resolvedOrganizationId?: string | null` to `ContactMatchSource` and use it only as `archive_relationship` evidence against local contacts whose organization membership is supplied by the organizer context.
- [ ] Keep all match reasons stable and machine-readable, introducing `two_independent_context_clues`, `conflicting_context_clues`, and `insufficient_independent_context_clues` where needed.
- [ ] Run focused matcher tests and API typecheck.
- [ ] Commit: `feat(act-import): require independent clues for identity matches`

## Task 3: Build a bounded archive context index and cascade resolutions

**Files:**

- Create: `artifacts/api-server/src/features/act-replacement/context-index.ts`
- Create: `artifacts/api-server/src/features/act-replacement/context-index.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`

- [ ] Write failing index tests for normalized exact lookups by organization/contact/booking name, direct contact value, website host, city/region, event date/location, and allowlisted narrative phrases.
- [ ] Add failing tests proving stop words, short tokens, shared direct-contact values, and full timeline bodies are not retained in evidence.
- [ ] Add a failing adapter test for the cascade: resolve company first, then contact using contact name plus resolved company, then history using exact narrative reference plus the resolved contact/company.
- [ ] Add a failing adapter test that conflicting narrative and explicit relationship evidence leaves the timeline record unresolved.
- [ ] Run the focused index/adapter tests and confirm failures.
- [ ] Implement `buildActContextIndex(rows, localCandidates)` with `Map<string, readonly id[]>` indexes assembled in one pass and sorted/deduplicated once.
- [ ] Extend `OrganizerLocalCandidates` with active local organization-contact and booking-contact memberships; load them in `DrizzleProductionOrganizerStore.loadSources` with the other one-time candidate queries so relationship evidence does not trigger per-record database calls.
- [ ] Implement exact, allowlisted narrative extraction from `subject`, `regarding`, `details`, and `body`; retain only normalized phrases that map uniquely to indexed canonical records and return sanitized labels such as `subject mentions company name`.
- [ ] Refactor `manifestSourcesFromArchiveRows` into deterministic passes:
  1. normalize and resolve companies;
  2. resolve contacts using canonical clues and resolved company parents;
  3. resolve bookings using resolved organizations and event clues;
  4. resolve calling lists and timeline dependencies using explicit relationships, event context, and narrative context;
  5. replay unresolved dependents once after parent resolutions stabilize.
- [ ] Keep `resolveActSourceGraph` authoritative for explicit source edges; layer inferred context evidence beside it rather than changing its explicit-evidence contract.
- [ ] Add resolved source-parent IDs to `ManifestSourceInput.relationships` only when the context resolver identifies one compatible source parent with two independent families and no conflict.
- [ ] Run focused tests, then `pnpm --filter @workspace/api-server run typecheck`.
- [ ] Commit: `feat(act-import): cascade archive context resolution`

## Task 4: Persist evidence and ensure diagnostics do not block core records

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/manifest-builder.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/manifest-builder.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-reader.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-reader.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`

- [ ] Write failing manifest tests proving a context-resolved match stores sorted sanitized evidence in `outcome.match`, creates safe link/fill operations, and still emits field conflicts for populated differing local values.
- [ ] Write failing tests proving unsupported paths/normalized fields remain diagnostics and provenance while supported core operations stay `ready`.
- [ ] Write failing review-reader tests that expose `recommendation` and evidence labels without raw values or timeline bodies.
- [ ] Run focused tests and confirm failures.
- [ ] Add to `ReviewRow`:

  ```ts
  recommendation?: {
    action: "link_existing" | "import_new" | "assign_parent" | "keep_archived";
    target?: ReviewCandidate;
    confidence: "authoritative" | "two_independent_clues";
    evidence: Array<{ family: ContextClueFamily; label: string }>;
  };
  ```
- [ ] Project recommendations only from validated structured `match.evidence`; never trust arbitrary JSON labels and cap evidence at seven entries.
- [ ] Preserve evidence through existing `act_replacement_outcomes.match`; do not add a migration.
- [ ] Include clue-family labels in provenance operation payloads while leaving raw source data in the archive only.
- [ ] Run focused tests and API typecheck.
- [ ] Commit: `feat(act-import): expose safe match recommendations`

## Task 5: Extend bounded bulk review for remaining duplicate recommendations

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.test.ts`
- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Modify: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`

- [ ] Write failing service and route tests for bulk `duplicate_identity` decisions with `link_existing` and `keep_separate`, including manifest digest, source version, target type/ID, homogeneous recommendation signature, idempotency, stale-manifest rejection, and the existing 200-selection cap.
- [ ] Add failing tests that reject cross-target, mixed-confidence, conflicting, or evidence-free selections.
- [ ] Run focused tests and confirm failures.
- [ ] Add `duplicate_identity` to `BulkReviewDecisionInput`, route Zod schemas, and client request types without changing the database enum/check constraints, which already support this scope and both decisions.
- [ ] In `prepareBulkReviewDecisions`, validate every selected outcome against its current structured recommendation and current manifest digest before writing decisions.
- [ ] Keep the existing atomic save-and-rebuild flow so accepted recommendations immediately regenerate the durable manifest from the saved archive.
- [ ] Run focused tests and API typecheck.
- [ ] Commit: `feat(act-import): bulk resolve context recommendations`

## Task 6: Add review evidence and mobile-friendly bulk actions

**Files:**

- Modify: `artifacts/adventure-zone/src/features/act-replacement/act-replacement-client.ts`
- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-review.tsx`
- Modify: `artifacts/adventure-zone/src/components/act-replacement/import-review.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`

- [ ] Write failing component tests for an evidence summary (`Matched from name + company relationship`), a recommendation checkbox, select-all-on-page for homogeneous safe recommendations, and full-width mobile bulk actions.
- [ ] Write a failing page test proving assignment targets are fetched only after a user types in a specific target search, never once per rendered card.
- [ ] Write failing page tests that accepted context matches and clear unmatched imports call bounded bulk endpoints and refresh both workflow counts and review rows after rebuild.
- [ ] Run the focused frontend tests and confirm failures.
- [ ] Render recommendation evidence with human labels and target details; do not render normalized secret/raw values.
- [ ] Add bulk actions:
  - `Accept selected safe matches` for homogeneous `link_existing` recommendations;
  - `Import selected as new` for homogeneous clear unmatched supported records;
  - retain existing relationship/conflict/unsupported bulk actions.
- [ ] Keep `Import safe records` as a separate final action that is the only action applying CRM changes.
- [ ] Ensure controls stack on narrow screens and do not overlap the fixed navigation/new-event controls.
- [ ] Run focused frontend tests and `pnpm --filter @workspace/adventure-zone run typecheck`.
- [ ] Commit: `feat(act-import): add context review bulk workflow`

## Task 7: Verify determinism, memory safety, and the production workflow

**Files:**

- Modify: `artifacts/api-server/src/features/act-replacement/production-organizer.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/one-time-import.integration.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/production-review.test.ts`
- Modify: `scripts/verify-act-replacement-preview.ts` if its assertions need the new evidence fields

- [ ] Add a failing organizer regression test with shuffled archive rows/candidates and assert identical manifest digest, outcomes, evidence ordering, and operation ordering.
- [ ] Add a representative high-volume test with at least 16,252 source records using repeated names/shared values; assert bounded evidence counts and completion without an all-pairs candidate matrix.
- [ ] Add an integration test proving rebuild uses archived observations and does not invoke extraction/network code.
- [ ] Add an integration test proving apply closure includes newly safe dependencies but excludes unresolved/conflicting records.
- [ ] Run focused integration tests, then:

  ```bash
  pnpm --filter @workspace/api-server test
  pnpm --filter @workspace/adventure-zone exec vitest run
  pnpm run typecheck
  pnpm run build
  ```

- [ ] Run `pnpm run verify:act-preview` when its required local test fixtures/environment are available; otherwise document the exact environmental blocker without claiming it passed.
- [ ] Inspect `git diff --check` and `git status --short`; verify no generated artifacts, credentials, raw Act payloads, or unrelated changes are included.
- [ ] Commit: `test(act-import): verify context resolution workflow`

## Task 8: Review and publish the pull request

**Files:**

- Review all changed files from Tasks 1–7.

- [ ] Use `superpowers:requesting-code-review` to review the completed diff and address validated findings.
- [ ] Use `superpowers:verification-before-completion` and rerun the full commands from Task 7 after the final edit.
- [ ] Summarize the safety contract in the PR: two independent clue families, conflict/tie fallback, no non-empty overwrite, unsupported-field preservation, bounded bulk actions, and no Act refetch.
- [ ] Use `github:yeet` to commit any final verified changes, push `agent/context-clue-review`, and open a PR against the repository's default branch.
- [ ] Include test commands/results and call out any intentionally unresolved manual-review categories in the PR body.
