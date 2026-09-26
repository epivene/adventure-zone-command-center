# Assistant costs and phone-first offline workspace

The user approved visible dollar costs and reliable offline access to saved records and drafts. Their Galaxy Fold is the primary device; desktop support should use the same browser implementation. This release does not download a generative model or change the OpenAI account's billing settings.

## Cost display

Record provider usage per completed model call, including input, cached input, output, actual model, service tier and a dated pricing version. Persist estimates with run checkpoints so resumed runs do not double-count tools. Show a USD estimate for the current conversation and latest run. Distinguish incomplete estimates and old unmetered runs from zero cost. Unknown models or tiers must never silently use an unrelated rate. Document reading and public research usage must either be counted or explicitly identified as excluded. Provider billing remains authoritative, especially for interrupted calls. Do not estimate historical costs from combined token totals.

## Prepared offline workspace

Provide an explicit Prepare for offline control in the assistant workspace. Save the current conversation, available selected-profile snapshots, applicable business rules and saved email drafts. Label snapshot times and limitations. Preparation must verify both local data storage and complete production application assets before reporting ready. Keep at most 10 prepared conversations. Do not replace pending local edits when refreshing snapshots. A dedicated /assistant/offline route renders only locally saved data and can open after restarting without internet. It does not grant a server session or bypass protected online routes.

Bind prepared data to a digest of the currently verified owner token, expire access at the earlier of token expiry or 7 days after preparation, and remove prepared data on logout, token replacement or confirmed authentication rejection. A transient network failure must not delete local work. Never store private API responses in the service-worker cache. The shell cache contains same-origin static assets and HTML only. Validate complete caches; a failed asset request must never receive HTML as JavaScript. Support the configured Vite base path.

Allow subject/body edits to existing prepared drafts, preserve their branded HTML and recipient/attachment metadata, and save edits explicitly on this device. Clearly distinguish local saves from server or Gmail saves. On reconnect, an explicit Sync draft changes action sends the original revision through the existing PATCH endpoint. A conflict retains the local edits for copying/reconciliation. A successful PATCH advances the revision locally even if a subsequent refresh fails. Never send email or save to Gmail automatically. Check current draft state before reconciling uncertain retries and do not overwrite concurrent changes.

Read-only offline records must not imply current balances, availability, insurance coverage or Gmail state. Screenshot files and protected document downloads are not included in this release. AI chat requires a connection; full on-device generative chat is a later increment.

## Verification

Test pricing arithmetic/cached input/unknown rates and checkpoint resumption; local-storage failure, token isolation/expiry/logout, preserving edits across preparation, reload and conflict; worker cache completeness, navigation fallback and asset failure behavior. Build both applications with Node 22 and compare typecheck results to the existing baseline. Obtain an independent review. A physical Fold airplane-mode restart remains a device acceptance check unless directly observed.
