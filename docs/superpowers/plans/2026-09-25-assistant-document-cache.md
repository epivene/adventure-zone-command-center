# Assistant Document Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reuse authorized document readings while preventing duplicate uncertain visual calls.

**Architecture:** An owner/source/bytes scoped durable extraction store wraps the existing reader after fresh source loading. It records started/completed state and immutable bounded results. Production loading enforces selected customer and connection identity; provider usage and partial completeness survive reuse.

**Tech Stack:** Node 22, TypeScript, PostgreSQL/PGlite, pdfjs, OpenAI SDK, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-assistant-continuity.md`

## Global Constraints

- Node 22; existing Express/React/PostgreSQL stack and dependencies.
- Feature remains disabled by default; no deployment or production activation.
- No customer messages or live provider calls during validation.
- Existing review, permission, revision, receipt and lease boundaries remain authoritative.
- Production activation still requires live browser/provider acceptance and owner configuration.

## Review Focus

- Same bytes linked to another customer must not reuse another source's authority.
- Removed customer links or deleted documents block before cache disclosure.
- A crash after billing cannot retry merely because model or run changed.
- Known partial response usage must not disappear with its incomplete status.
- Cached scans retain page gaps and visual verification requirements.

### Task 1: Durable extraction reuse

Files: new `document-extraction-store.ts` and tests; existing `document-reader.ts`, reader tests, mirrored startup/SQL migrations.

Interfaces: `DocumentExtractionStore.execute(context, key, extract)` claims an owned run, returns a bounded `ToolResult` with cache/extraction metadata; repeated results omit historical `usage`. Reader calls fresh loader first and reconstructs evidence with current record/year/retrieval time.

- [x] Write failing real-PDF/scan tests asserting `expect(visualExtract).toHaveBeenCalledTimes(1)` after repeated read and `expect(reused.usage).toBeUndefined()`; changed bytes, identity, access and interrupted claims are separate cases.
- [x] Run targeted tests to record failure before implementation.
- [x] Add idempotent schema; key hash includes actor/source/connection/bytes/revision. `INSERT ... ON CONFLICT DO NOTHING` claims once; existing started state returns `usageUnknown: true`. Validate stored artifact size/status before saving.
- [x] Rehydrate current source provenance after cache, preserve missing pages and partial state, test migration twice and commit.

### Task 2: Production access and visual usage

Files: `production-reads.ts`, focused source-access helper/tests, `visual-reader.ts` and tests, `document-comparison.ts` and tests, result cards/projections where applicable.

Interfaces: visual extraction accepts context and returns optional known usage plus `usageUnknown`; production selects model from the owned saved run. Shared source validator checks selected organizations against fresh document links or Gmail thread associations.

- [x] Write failing tests for selected-model forwarding, incomplete usage, body timeout and comparison early stop: `expect(reader.read).toHaveBeenCalledTimes(1)` when first source has unknown usage.
- [x] Use `AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])` across response lifetime; mark transport uncertainty explicitly and never retry automatically.
- [x] Add fresh selected-customer and attachment-membership checks before bytes/cache. Preserve current connection validation.
- [x] Run targeted tests, affected workspace/service regression, builds and typecheck comparison; request fresh whole-branch review, fix findings, update rollout record and publish a draft PR.
