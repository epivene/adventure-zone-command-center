# On-Device AI Assistant Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in local semantic AI layer to the Booking Assistant so strong cached-context matches can be answered on-device before using paid cloud AI.

**Architecture:** Extend the existing offline cache/assistant API path with a pure task router, bounded local document builder, lazy CDN-loaded Transformers.js embedding runtime, and client-side semantic answer path. Deterministic answers remain first, local semantic AI is second, and the existing cloud API remains the fallback.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, localStorage, pinned Transformers.js 4.2.0 browser ES module, existing assistant cache/API types.

**Spec:** `docs/superpowers/specs/2026-08-25-on-device-ai-design.md`

## Global Constraints

- No runtime/model download until the user explicitly enables On-Device AI on that device.
- Deterministic cached answers always run before semantic inference.
- Local semantic answers may only use bounded cached assistant context already present in the browser.
- No server/database migration is required.
- Do not modify `package.json` or `pnpm-lock.yaml` for the local AI runtime; use the pinned browser CDN module.
- Strong local match threshold starts at cosine similarity `0.48`.
- At most 80 local documents and 1,200 characters per document.
- Model/runtime failures must never break the existing assistant.
- Local semantic answers are ephemeral and must not be persisted as server-generated conversation messages.
- Whisper, Chrome built-in AI, local generative chat, and full-CRM offline indexing are out of scope.

---

### Task 1: Add pure local routing and document construction

**Files:**
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-router.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-router.test.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-documents.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-documents.test.ts`

**Interfaces:**

```ts
export type LocalAssistantIntent =
  | "exact_cached_answer"
  | "semantic_cached_search"
  | "cloud_required";

export function routeLocalAssistantQuestion(question: string): LocalAssistantIntent;

export type LocalAssistantDocument = {
  id: string;
  text: string;
  sourceIds: string[];
  kind: "brief" | "booking" | "context";
};

export function buildLocalAssistantDocuments(
  snapshot: AssistantCachedSnapshot,
): LocalAssistantDocument[];
```

- [ ] Write failing router tests for schedule/contact/follow-up/package-history exact routing, vague cached recall semantic routing, and writing/web/strategic questions cloud routing.
- [ ] Run `pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/on-device-ai-router.test.ts` and verify RED.
- [ ] Implement the pure normalized-text router.
- [ ] Run the router test and verify GREEN.
- [ ] Write failing document-builder tests for brief items, booking descriptors, allowed short context strings, dedupe, 80-document cap, 1,200-character cap, source mapping, and nested/HTML/token-like exclusions.
- [ ] Run `pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/on-device-ai-documents.test.ts` and verify RED.
- [ ] Implement the bounded allowlist builder.
- [ ] Run document-builder tests and verify GREEN.

---

### Task 2: Add local embedding runtime and similarity ranking

**Files:**
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-runtime.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-runtime.test.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-ranking.ts`
- Create: `artifacts/adventure-zone/src/features/assistant/on-device-ai-ranking.test.ts`

**Interfaces:**

```ts
export type OnDeviceAiStatus =
  | "disabled"
  | "available"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export type OnDeviceAiProgress = {
  status: OnDeviceAiStatus;
  progress: number | null;
  message: string | null;
};

export function isOnDeviceAiEnabled(): boolean;
export function setOnDeviceAiEnabled(enabled: boolean): void;
export function initializeOnDeviceAi(): Promise<void>;
export function subscribeOnDeviceAi(listener: (state: OnDeviceAiProgress) => void): () => void;
export function getOnDeviceAiState(): OnDeviceAiProgress;
export function embedLocalTexts(texts: string[]): Promise<number[][]>;

export function rankLocalDocuments(input: {
  queryEmbedding: number[];
  documentEmbeddings: number[][];
  documents: LocalAssistantDocument[];
}): Array<{ document: LocalAssistantDocument; score: number }>;
```

- [ ] Write failing ranking tests for cosine ordering, zero-vector safety, stable ties, and score preservation.
- [ ] Run focused ranking test and verify RED.
- [ ] Implement ranking.
- [ ] Write runtime tests with an injected CDN module loader: disabled never loads, enable stores local preference, explicit initialization loads once, progress emits, failure becomes `error`, disable blocks future inference.
- [ ] Run runtime test and verify RED.
- [ ] Implement a lazy Vite-ignored dynamic import of `https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0`; create the `feature-extraction` pipeline for `onnx-community/all-MiniLM-L6-v2-ONNX`, use mean pooling/normalization, enable browser cache, and keep WASM as the broad fallback.
- [ ] Run runtime/ranking tests and verify GREEN.

---

### Task 3: Integrate on-device semantic answers into assistant API

**Files:**
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts`
- Modify: `artifacts/adventure-zone/src/features/assistant/assistant-types.ts`

**Interfaces:**

```ts
export type ClientAssistantAnswer = Omit<AssistantAnswer, "mode"> & {
  mode: AssistantAnswer["mode"] | "on_device";
};
```

Behavior for `askBookingAssistant`:

1. load cached snapshot if available,
2. run existing deterministic cached answer logic first,
3. if router says semantic and local AI is enabled/ready-or-loadable, build documents and rank embeddings,
4. if top score >= 0.48, return 1-3 grounded snippets as `mode: "on_device"` without calling `/assistant/ask`,
5. otherwise use existing cloud path when online,
6. if offline and no strong semantic match, keep transparent cached fallback behavior.

- [ ] Add failing integration tests proving deterministic answer wins before local AI, strong local match avoids `apiPost`, weak local match falls through online, weak local match stays transparent offline, and local runtime failure does not block cloud.
- [ ] Run `pnpm exec vitest run artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts` and verify RED.
- [ ] Implement the local semantic attempt helper with an 8-second timeout.
- [ ] Update client answer types without changing server-persisted answer-mode unions.
- [ ] Run assistant API tests and verify GREEN.

---

### Task 4: Add opt-in On-Device AI control to Booking Assistant drawer

**Files:**
- Create: `artifacts/adventure-zone/src/components/assistant/on-device-ai-control.tsx`
- Create: `artifacts/adventure-zone/src/components/assistant/on-device-ai-control.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-drawer.tsx`
- Modify: `artifacts/adventure-zone/src/components/assistant/assistant-message.tsx` if answer-mode labeling needs an `On-device` badge.

**Behavior:**

- disabled: `On-device AI · Enable` and helper copy about free local matching/small model download,
- loading: progress/initializing state,
- ready: `On-device ready · Turn off`,
- error/unavailable: compact explanation with normal assistant still usable,
- enabling explicitly initializes/downloads the runtime/model,
- disabling only turns use off; browser caches may remain.

- [ ] Write failing UI tests for disabled-no-download, enable, loading, ready, error, and turn-off states.
- [ ] Run focused component test and verify RED.
- [ ] Implement the control and connect it to runtime subscription.
- [ ] Add it to the assistant drawer without changing Scout mode behavior.
- [ ] Run control/drawer tests and verify GREEN.

---

### Task 5: Verify deployment safety and regressions

**Files:** Review all changed files only.

- [ ] Run focused on-device tests:

```bash
pnpm exec vitest run \
  artifacts/adventure-zone/src/features/assistant/on-device-ai-router.test.ts \
  artifacts/adventure-zone/src/features/assistant/on-device-ai-documents.test.ts \
  artifacts/adventure-zone/src/features/assistant/on-device-ai-ranking.test.ts \
  artifacts/adventure-zone/src/features/assistant/on-device-ai-runtime.test.ts \
  artifacts/adventure-zone/src/features/assistant/assistant-api.test.ts \
  artifacts/adventure-zone/src/components/assistant/on-device-ai-control.test.tsx
```

- [ ] Run adjacent assistant regression tests:

```bash
pnpm exec vitest run \
  artifacts/adventure-zone/src/components/assistant/assistant-drawer.test.tsx \
  artifacts/adventure-zone/src/components/assistant/assistant-message.test.tsx
```

- [ ] Run `pnpm --filter @workspace/adventure-zone run typecheck`.
- [ ] Run `pnpm --filter @workspace/adventure-zone run build`.
- [ ] Confirm `package.json` and `pnpm-lock.yaml` are unchanged by this feature.
- [ ] Review final diff for accidental runtime/model auto-loading, server answer-mode changes, cloud-call regressions, or unrelated UI changes.
- [ ] Open PR with exact verification evidence and merge only after the branch is reviewable.