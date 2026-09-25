# Assistant draft editing, model choices and Fold layout

## Behavior

The workspace uses one main chat pane below 1280 CSS pixels, chat/results from 1280, and history/chat/results from 1536. Conversations and results open in named native dialog sheets on compact screens. Each panel keeps its children mounted across close/reopen and breakpoint changes, so unsaved draft text survives folding or dismissing the sheet. Chat uses 16px message/composer text, a bounded scrolling history and a visible composer. New messages follow the bottom unless the reader has scrolled back. Ready setup is compact; app padding is reduced only for this route, duplicate floating assistant is hidden, and pinch zoom is permitted.

A small Tap to edit button in the email preview opens direct subject and rendered text editing. The rest of the sandboxed iframe remains scrollable. Editable text is a safe React projection of inert HTML: no email scripts, resource URLs, navigation, handlers, or source classes enter the app DOM. Edited text nodes are serialized back into the original template, retaining branding, links, attachments and recipients. Images show alt-text placeholders while editing and remain in the saved template. Plaintext is regenerated from the edited body.

Save changes PATCHes the existing actor-owned, revision-checked draft endpoint without starting an AI run or writing to Gmail. The returned revision is used immediately. Gmail save and send review remain separate; editing a saved draft makes it local again and retains its existing Gmail ID. Busy/uncertain/sent drafts cannot be edited. Failed saves and competing revisions preserve local edits. Conversation refreshes cannot replace a newly saved revision with an earlier in-flight read. Conversation switching and the Business rules tab are guarded while editing; refresh/close warns about unsaved edits. Global SPA navigation and browser Back can still discard unsaved edits.

## Models

GPT-5.4 Mini and GPT-5.4 Nano both completed a small Responses API probe using the production connection, with store:false, the adapter's parallel-tool and reasoning-content options, and a no-op tool definition. Both returned MODEL_OK; no business tool was executed. The existing Sol/Astra/Luna choices are retained. UI labels explain intended use, and unknown future configured models retain their literal identifiers. The server allowlist remains authoritative.

Official model references checked September 25, 2026:
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/models/gpt-5.4-nano

These model pages support screenshot inputs, streaming and function calling. The production allowlist update is a separate configuration operation; it is not hardcoded or silently broadened in the application.

## Verification

- Backend CI selection: 55 files / 265 tests passed (276.98 seconds), including the actual manual PATCH/Gmail revision regression.
- Assistant UI: 10 files / 37 tests passed, including direct editing, safe paste/markup, failed saves, stale revisions, panel state retention, screenshot uploads and the PATCH-to-Gmail UI flow.
- API and frontend production builds passed on Node 22.
- TypeScript remains at the existing API 94 / UI 135 diagnostic baseline, with no additional file/error-code diagnostics.
- An intermittent screenshot setup race exposed that changing setup readiness could reset the whole composer. Conversation reset is now separate from readiness-triggered fetching, so setup checks do not clear pending message text or images.

The existing app-shell source-string suite has three pre-existing failing assertions: literal polling value 15000 and two old AppMenu prop strings. All three expected strings are already absent at base 18b9a5c; this change does not alter the polling cadence or those AppMenu calls.

An independent whole-branch review found one preview-scroll regression from an oversized edit hotspot. Restricting it to a small button closed that finding; no Critical/Important findings remain. Native dialog focus, software keyboard and physical Galaxy Fold sizing have not been visually verified in this environment. Post-deploy device checks should cover 375/768/1024/1280/1536px, sheet close/reopen, editing/paste, preview scrolling, and composer visibility with the keyboard open.
