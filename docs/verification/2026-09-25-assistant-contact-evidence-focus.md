# Assistant contact evidence and focused chat

## Reported behavior and cause

The deployed assistant offered a contact-row match as a profile without contact history because legacy profile search returned hardcoded null `lastContactAt` and `bookingCount` values. Contact rows also carried a contact UUID without an owning organization UUID. Workspace search accepted only a text query, so it could not directly find organizations without active contact records.

The unfolded-phone screenshot also retained three desktop columns. The previous layout used only 1280/1536 CSS-pixel queries, which the browser satisfied. Physical screenshot dimensions do not establish the CSS viewport, zoom, or primary pointer. Assistant responses were rendered as plain text, exposing Markdown syntax.

## Changes

- A workspace-specific search returns canonical organizations and measured active linked contact counts. It supports missing/present contact filters, optional name/contact/event/location matching, and 20-item pages. Consolidated profiles are excluded; contact records with blank email or phone still count as contacts. Older `{query}` tool calls remain valid, and the legacy chat repository is unchanged.
- Search results explicitly exclude communication history. A zero contact count means no current active contact record, not never contacted. Instructions direct the assistant to select and verify the canonical profile in the same task and use history/email evidence for outreach claims.
- Focused chat defaults on when the primary pointer is coarse. An always-visible Focus chat toggle saves an explicit preference. One shared layout decision controls columns, panel roles and navigation buttons. A single open-panel state prevents competing sheets. The existing editor stays mounted when switching layouts.
- Focused messages use 18px text and primary controls have 48px targets. Assistant Markdown renders through react-markdown with raw HTML disabled and remote images represented by text labels; unsafe links remain inert. User wording stays literal.

## Verification

- The new database regressions failed against the old implementation, reproducing the misleading contact ID and null-history fields, then passed with the fix. The focused backend selection passed 4 files / 22 tests, including legacy search.
- The complete Assistant Workspace CI backend selection passed 56 files / 273 tests (285.93 seconds), including connected office, inspection, contract and invoice workflows.
- Assistant UI CI selection passed 12 files / 46 tests. Coverage includes wide coarse and fine pointer modes, persisted explicit choices, pointer changes, narrow-screen fallback, editor identity and unsaved wording, stale sheet state, Markdown formatting and inert unsafe content.
- API and frontend production builds passed on Node 22.
- TypeScript diagnostics remain at the prior API 94 / UI 135 baseline, with no additional file/error-code counts.
- Independent whole-branch review found no Critical or Important findings after checking search semantics, authorization, pagination, layout state, editor preservation, Markdown safety, tests and dependency changes.

No business data or customer emails were changed during verification. The physical Galaxy Fold, browser zoom and software keyboard have not been visually verified. After deployment, check the automatic focused layout and saved toggle, open both sheets, edit and reopen a draft, and confirm composer visibility with the keyboard open.
