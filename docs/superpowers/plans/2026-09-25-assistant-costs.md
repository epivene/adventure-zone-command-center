# Assistant Cost Visibility Implementation Plan

> **For agentic workers:** Use the available collaboration tools for independent implementation and whole-branch review. Steps use checkbox syntax.

**Goal:** Show useful, explicitly estimated USD costs from measured provider usage.
**Architecture:** Meter provider calls in the API, accumulate idempotently in existing JSON checkpoints, expose a nullable cost summary, and render it in the assistant workspace.
**Tech Stack:** TypeScript, OpenAI Responses, PostgreSQL JSON checkpoints, React, Vitest.
**Spec:** `docs/superpowers/specs/2026-09-25-assistant-costs-offline-design.md`

## Global Constraints

- No billing settings or default model changes.
- Unknown or historical usage is not zero cost. Provider billing remains authoritative.
- Persist dated pricing and account for cached input separately from uncached input.

## Review Focus

- Cached input must not be charged twice.
- Resumed checkpoint tools must not be charged twice.
- Interrupted and legacy runs must be marked incomplete/unavailable.
- Long-context and unknown service tiers must not silently use standard short rates.
- Sub-cent charges must remain visible on a phone.

### Task 1: Provider usage and cost checkpoints

**Files:** `artifacts/api-server/src/features/assistant-workspace/{contracts,openai-model,orchestrator,public-research,document-reader,document-comparison}.ts`, new `usage-cost.ts`, related tests, and `src/routes/assistant-workspace.ts`.
**Interfaces:** Produce `usage.cost` summaries on conversation/run responses; coordinate the exact TypeScript shape before UI integration.

- [x] Add failing tests for exact arithmetic, known/unknown pricing, incomplete usage and resumed runs.
- [x] Record provider metadata and versioned estimates; safely propagate document/research usage.
- [x] Run relevant API tests using `/tmp/assistant-node22/node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1` from the API artifact; expect all selected tests to pass.

### Task 2: Cost UI

**Files:** `artifacts/adventure-zone/src/features/assistant-workspace/types.ts`, new `components/assistant-workspace/UsageCost.tsx`, its test, and `pages/AssistantWorkspacePage.tsx`.
**Interfaces:** Consume the API's `usage.cost`; tolerate absence on historical runs.

- [x] Test complete, partial, absent and sub-cent estimates.
- [x] Show latest-run and conversation estimates, with a concise explanation of scope.
- [x] Run assistant UI tests and production builds; expect green tests and successful builds.

Verification evidence: `docs/assistant-costs-offline-verification.md`.
