# Assistant Conversation Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Keep long conversations usable with source-linked bounded context and original history retrieval.

**Architecture:** The conversation store reads a bounded suffix through the owned source message. A deterministic context builder retains recent turns and quotes older messages; the orchestrator freezes this context before provider work. A separate history tool reads originals and the UI reports coverage.

**Tech Stack:** Node 22, TypeScript, PostgreSQL/PGlite, Express, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-25-assistant-continuity.md`

## Global Constraints

- Node 22; existing Express/React/PostgreSQL stack and dependencies.
- Feature remains disabled by default; no deployment or production activation.
- No customer messages or live provider calls during validation.
- Existing review, permission, revision, receipt and lease boundaries remain authoritative.
- Production activation still requires live browser/provider acceptance and owner configuration.

## Review Focus

- Interleaved conversations create sequence gaps; counts use rows, not subtraction.
- A reclaimed run cannot include newer messages or changed selection.
- Historic scope changes cannot turn a customer exception into general policy.
- A quoted assistant success claim cannot become a verified receipt.
- Missing or legacy summary JSON cannot break ordinary chat.

### Task 1: Bounded owned history and context

Files: create `conversation-context.ts`, `history-tools.ts` and tests alongside workspace services; extend `conversation-store.ts` and its tests.

Interfaces: `ConversationStore.context(actorId, conversationId, sourceMessageId)` returns `SavedConversationContext`; `history(actorId, conversationId, sourceMessageId, {beforeSequence?, query?})` returns at most three source-linked messages plus next cursor. `SavedConversationContext` contains source ID/sequence, recent turns and memory entries/counts. SQL joins the message's run to label requested and resulting scope separately.

- [x] Write failing behavioral tests, including `expect(context.turns).toHaveLength(6)`, owner/source rejection, future exclusion and unchanged originals.
- [x] Run `vitest run src/features/assistant-workspace/conversation-store.test.ts --maxWorkers=1` and capture the failure.
- [x] Implement bounded SQL and excerpt building: `excerpt = text.slice(0, 1200)`; `omittedMessageCount = total - recent.length - entries.length`; parameterize history query and cursor.
- [x] Register the tool with server-owned run cutoff, run tests and commit the working context path.

### Task 2: Frozen model context and visible continuity

Files: `contracts.ts`, `orchestrator.ts`, `worker.ts`, `openai-model.ts`, `runtime.ts`, workspace page/types and focused tests.

Interfaces: optional `ModelInput.memory` and `TurnCheckpoint.context`; `TurnStore.load()` optionally supplies context. Provider receives quoted memory in a distinct untrusted data message, never as current user authorization.

- [x] Add failing restart test: `expect(reclaimedInput.turns).toEqual(firstInput.turns)` after later messages appear; assert save precedes provider invocation and history cannot add current receipts.
- [x] Implement `cp.context ??= loaded.context; await store.save(cp)` before provider use; use saved turns/memory thereafter, without changing active provider items.
- [x] Store the latest overview monotonically in existing summary JSON; show omitted counts and original-message links with an explicit limited-coverage label.
- [x] Run affected backend/UI tests, then commit. Keep existing single-run size limits and fresh rules.
