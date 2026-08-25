# On-Device AI Assistant Layer Design

## Goal

Add a free/on-device intelligence tier to AdventureZone Command Terminal so routine assistant work can run locally before falling back to paid cloud models.

The first release focuses on three things only:

1. local task routing,
2. local semantic matching/search over cached assistant context,
3. a better offline assistant fallback.

Whisper transcription and a full local chat LLM are explicitly deferred to a later release.

## Existing foundation

The current Booking Assistant already has an offline snapshot cache and deterministic offline answers for saved schedules, contacts, follow-up details, package history, and similar booking context. That existing cache remains the source of truth for offline data.

The new layer extends that flow rather than creating a second assistant architecture.

## Product behavior

The assistant uses this execution ladder for every question:

1. **Deterministic local logic** — dates, exact cached fields, command recognition, existing offline brief answers.
2. **On-device semantic AI** — embeddings/classification over cached data when the local model has been enabled and downloaded.
3. **Cheap cloud AI** — existing Booking Assistant/OpenAI path when a live connection is available and local confidence is not sufficient.
4. **Deep Research** — remains an explicit user-selected operation; this release does not change Scout deep-research model selection.

The user should not have to know which layer answered. The answer metadata can show `On-device` when useful, but routing is automatic.

## Privacy and cost rules

- On-device inference sends no CRM text to Hugging Face or OpenAI after the model files have been downloaded.
- Model/runtime files may be fetched only after the user explicitly enables On-Device AI.
- The app must not auto-download a model or AI runtime on first page load.
- No API-key-backed cloud call is made when a local answer is accepted with sufficient confidence.
- The local layer may only use data already present in the browser's assistant cache or data explicitly passed into the current assistant context.
- The browser cache remains device-local and disposable.

## Model and runtime choice

Use Transformers.js in the browser with a small sentence-embedding model suitable for semantic similarity.

Initial model:

`onnx-community/all-MiniLM-L6-v2-ONNX`

Task: `feature-extraction`

Transformers.js runtime:

`https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0`

Version 4.2.0 is pinned rather than floating. Hugging Face documents ES-module CDN loading as a supported browser installation path. Loading the runtime from the CDN avoids modifying the application's pnpm dependency graph and therefore avoids unnecessary risk to Render's frozen-lockfile deployment.

Inference settings:

- pooling: `mean`
- normalize: `true`
- default device: WASM/CPU for broad compatibility
- optional WebGPU may be attempted only when browser support is present and initialization succeeds
- browser model caching enabled

The model is intentionally small enough for browser use and is not a generative LLM.

## Capability states

The client exposes a small local-AI runtime state machine:

- `disabled` — user has not enabled local AI on this device.
- `available` — browser can run the runtime but the model has not been loaded this session.
- `loading` — runtime/model files are loading.
- `ready` — embeddings can be generated.
- `unavailable` — browser/runtime cannot support the model.
- `error` — initialization failed; cloud/deterministic behavior continues normally.

Enabled/disabled preference is stored in localStorage per device.

## UI

The Booking Assistant drawer gets a compact owner-facing On-Device AI control near the assistant header/offline status area.

When disabled:

- label: `On-device AI`
- action: `Enable`
- helper text: `Free local matching on this device. Downloads a small model.`

When loading:

- show download/loading progress when Transformers.js reports it.

When ready:

- status: `On-device ready`
- action: `Turn off`

When unsupported/error:

- show a compact non-blocking explanation.
- existing assistant behavior remains available.

This first release does not add a separate settings page.

## Local task router

Create a pure router that classifies assistant questions before inference.

Initial intents:

- `exact_cached_answer`
- `semantic_cached_search`
- `cloud_required`

### exact_cached_answer

Questions already handled well by deterministic cache logic, including:

- schedule/date/time questions,
- primary contact questions,
- follow-up/next action questions,
- package-history questions,
- "what happened last year" questions.

These stay on the current deterministic path and do not invoke the embedding model.

### semantic_cached_search

Questions asking to locate, recall, or compare information inside the current cached profile context, especially vague wording such as:

- `What was that thing they complained about?`
- `Did they ever mention power?`
- `Find the note about the water hookup.`
- `What did we promise them?`

These can use semantic similarity over cached brief items and selected cached context text.

### cloud_required

Questions requiring new reasoning, writing, live CRM data outside the cache, web research, or unsupported operations.

Examples:

- draft a new sales email,
- compare current inventory across unrelated profiles,
- research a new event,
- make a strategic booking recommendation not supported by cached facts.

If offline, these retain the existing low-confidence offline explanation.

## Semantic document set

The local matcher only indexes a bounded current-context corpus assembled in memory from the cached snapshot.

Document sources:

1. Booking Brief items.
2. Cached source labels/context excerpts already included in the assistant snapshot.
3. Current/prior booking descriptors.
4. Other short string fields from the cached context allowlist.

Do not recursively stringify arbitrary cached objects.

Each local document has:

```ts
type LocalAssistantDocument = {
  id: string;
  text: string;
  sourceIds: string[];
  kind: "brief" | "booking" | "context";
};
```

Limits:

- at most 80 documents,
- at most 1,200 characters per document,
- ignore blank or duplicate normalized text,
- never index secrets, tokens, raw HTML blobs, attachment binaries, or internal IDs as prose.

## Semantic answer behavior

For a `semantic_cached_search` question:

1. build/reuse the local document corpus for the cached snapshot,
2. embed the question and corpus,
3. cosine-rank matches,
4. require a minimum similarity threshold,
5. return the top 1-3 grounded snippets with their existing CRM source references.

Initial threshold:

- strong local answer: cosine similarity >= 0.48,
- weak/no match: fall through to cloud when online,
- weak/no match while offline: return a transparent `I couldn't find that in the saved profile context` answer.

The local semantic layer does not synthesize unsupported facts. It returns concise grounded text assembled from the matched cached documents.

## Runtime and caching

Create a singleton client-side runtime so the model is loaded at most once per page session.

Runtime behavior:

- lazy dynamic CDN import with Vite ignored for bundling,
- no runtime/model download until the user presses Enable,
- browser model caching enabled,
- remote model loading allowed only while local AI is enabled,
- no model loading during server-side/non-browser work,
- normal app startup has zero Transformers.js bundle cost.

The initial enable action requires internet access unless the runtime/model were already retained by browser caches. Later offline availability is best-effort and browser-cache-dependent; deterministic offline answers remain guaranteed independently of the model.

Embeddings for the current snapshot can be memoized in memory using a stable fingerprint of document IDs/text. Persisting embedding vectors to IndexedDB is not required in this release.

## Dependency and deployment

Do not add `@huggingface/transformers` to package.json in this release. Load the pinned browser ES module from jsDelivr only after explicit enable. This leaves `package.json` and `pnpm-lock.yaml` unchanged and preserves Render's existing `pnpm install --frozen-lockfile` behavior.

No backend dependency or database migration is required.

## API/type changes

Extend the client-only assistant answer mode to distinguish local semantic answers.

Current persisted server modes remain unchanged. The client may use:

```ts
type ClientAssistantAnswerMode =
  | AssistantAnswer["mode"]
  | "on_device";
```

Do not send `on_device` messages to the existing conversation persistence endpoint as if the server generated them. Local answers remain ephemeral in this release.

## Failure handling

- Runtime/model download or initialization failure never blocks the assistant.
- Unsupported WebGPU falls back to WASM rather than marking the feature unavailable.
- Offline + model not previously cached: deterministic offline answers still work; semantic AI reports that the local model is not available offline yet.
- Corrupt/failed browser cache: show a local-AI error and let the user disable/re-enable later.
- If semantic inference takes longer than a bounded timeout, abandon the local attempt and use the normal cloud path when online.

Initial timeout: 8 seconds per semantic query after the model is ready.

## Testing

### Pure unit tests

- task router selects deterministic, semantic, or cloud path correctly,
- document builder obeys allowlist, limits, deduplication, and source mapping,
- cosine ranking and threshold logic are deterministic,
- unsafe/arbitrary nested context is not indexed.

### Runtime tests

Inject/mock the CDN module loader and verify:

- disabled state never loads the runtime/model,
- enabling loads once and stores the per-device preference,
- ready runtime embeds question/documents,
- failed initialization falls back without throwing through the assistant UI,
- model progress updates the UI state,
- disabling prevents future local inference without deleting the browser's model cache.

### Assistant integration tests

- existing deterministic cached answers still win before semantic inference,
- strong semantic cached match produces an `on_device` answer without calling `/assistant/ask`,
- weak local match falls through to `/assistant/ask` online,
- weak local match offline returns a transparent cached answer,
- local model unavailable does not break normal online assistant behavior.

### UI tests

- Enable does not happen automatically,
- enabled preference is per-device/localStorage,
- loading/ready/error states render compactly,
- drawer remains usable when local AI fails.

## Release boundary

This release is complete when the Booking Assistant can optionally enable a small local embedding model, route eligible cached-context questions through it for free, avoid unnecessary cloud calls for strong local matches, and fall back safely to the existing deterministic/cloud assistant paths.

Whisper transcription, browser-managed Chrome AI APIs, local generative chat models, and full-CRM offline indexing are separate follow-up releases.