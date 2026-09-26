# Assistant cost visibility and offline workspace verification

## Scope

This change shows estimated USD costs for the latest assistant run and the conversation, and adds an explicitly prepared offline workspace for phone and desktop browsers. Users can read saved conversation/profile/rule snapshots, edit the subject and branded body of existing drafts, save on the device, and deliberately sync changes to the app after reconnecting.

It does not download an on-device AI model. AI chat and live Gmail access require internet. Screenshot files and protected document binaries are not downloaded. No model defaults, account billing settings, production records, Gmail drafts, or sent emails were changed during development.

## Cost behavior

- Meter actual returned model, service tier, input/output tokens, cache reads/writes, and response identity. Persist a dated pricing version with checkpoints; resumed tools do not count twice.
- Conversation totals include all stored runs. Older/unmetered usage and unsupported model/tier/long-context pricing are unavailable or partial, never silently priced as zero.
- Tool model usage is included where measured. Hosted web-search fees are explicitly excluded. Unknown interrupted provider charges may be absent; OpenAI billing remains authoritative.
- Very small positive estimates display `<$0.0001`, separately from measured zero.
- Standard pricing snapshot: `openai-standard-2026-09-25`, checked against https://developers.openai.com/api/docs/pricing and https://developers.openai.com/api/docs/guides/prompt-caching. Estimates are not a live account billing total.

## Offline behavior and safeguards

- Prepare the current conversation online before going offline. Preparation verifies the owner session, static shell assets and saved data before reporting readiness. At most ten conversations are retained; pending drafts are not silently evicted.
- Saved snapshots are tied to the current owner-token digest. Access expires after seven days or token expiry, whichever occurs first. Logout, token replacement and confirmed authentication rejection remove saved records. Connection failures retain local work without opening protected online routes.
- Service-worker caching is limited to same-origin static application assets. Private API responses are excluded. Partial preparation preserves a prior complete cache, and an asset failure never returns HTML as JavaScript.
- Offline records display snapshot ages and do not assert live balances, availability, insurance or Gmail state. External images do not load in the offline email editor.
- Device saves/discards compare the exact local version inside the IndexedDB transaction. Dirty editor content stays pinned during reloads; stale edits cannot overwrite another tab. Cancel unsaved editing reloads the saved copy without deleting persisted edits.
- Synchronization uses explicit user action and the existing revision-checked draft PATCH. Conflicts retain both copies. Unknown responses reconcile full content, including recipient/attachment metadata. Late replies cannot replace newer local state. No sync action sends email or changes Gmail automatically.

## Validation

Runtime: Node 22.23.2. Source baseline: local `565be58`, with every changed baseline blob verified against remote main `38397cd05cf57a93919792960615d38d7a084383` before publication.

- Focused final review regressions: 4 files, 38 tests passed. The stale-save/discard, late-conflict and tiny-cost cases were observed failing before their fixes.
- Selected frontend assistant/offline/auth/routing suite: 29 files, 139 tests passed.
- Selected API assistant feature and route suite: 48 files, 252 tests passed.
- Both API and frontend production builds passed. Vite reported its existing large-chunk advisory.
- Root-path production shell manifest: 240 entries, 4,145,272 bytes. Every entry exists and matches its SHA-256 digest; all emitted application JavaScript, CSS and font assets are included.
- Custom `/office/` production build passed; all 240 entries use the correct base path and match their SHA-256 digests (4,145,419 bytes).
- TypeScript diagnostics match clean `565be58` exactly by normalized file and error code: frontend 135 baseline/current, API 94 baseline/current. No new diagnostics. Whole-project typechecking has existing errors and is not represented as clean.
- Independent whole-branch source review found two important concurrent-edit issues and one minor rounding issue; all were fixed and rereviewed. No remaining Critical or Important findings were reported, subject to final validation.

Commands (from the named artifact directory):

```sh
# artifacts/adventure-zone
node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1 src/components/assistant-workspace src/features/assistant-workspace src/lib/auth-context.test.tsx src/lib/auth-token.test.ts src/lib/manager-auth-context.test.tsx src/lib/boss-auth-context.test.tsx src/lib/offline src/pages/AssistantOfflinePage.test.tsx src/App.office-routing.test.tsx src/App.manager-routing.test.tsx src/App.boss-workspace.test.tsx
node node_modules/vite/bin/vite.js build
BASE_PATH=/office/ node node_modules/vite/bin/vite.js build --outDir /tmp/assistant-office-build

# artifacts/api-server
DATABASE_URL=postgresql://test:test@localhost:5432/assistant_test node ../../node_modules/vitest/vitest.mjs run src/features/assistant-workspace src/routes/assistant-workspace.test.ts --maxWorkers=1 --hookTimeout=30000 --testTimeout=30000
node build.mjs
```

## Remaining device acceptance

A physical Galaxy Fold airplane-mode cold start has not been observed. After deployment: prepare a conversation while online, close and reopen the browser in airplane mode, open Offline workspace, edit/save a draft, reopen again to verify persistence, and reconnect to explicitly sync. Check both folded and unfolded layouts and the on-screen keyboard. Browser storage eviction can require preparation again; readiness is checked instead of assumed.
