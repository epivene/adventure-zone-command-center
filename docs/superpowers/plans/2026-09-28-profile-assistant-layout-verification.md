# Profile and assistant layout — verification

Base: `cb32da44f3801a8a432b43b63233bab5171d02dc` (`main`). Branch: `codex/profile-assistant-layout`.

## Delivered behavior

- Directory links open full profiles; safe return links preserve directory query state and saved scroll position. Direct profile links fall back to Profiles.
- Four primary profile actions: Follow up, Open emails, Add note, Assistant. Edit and secondary actions stay in More. Bookings/contracts, history and documents are grouped into their sections.
- Create/edit follow-ups use a portaled dialog with a calendar, typed MM/DD/YYYY date, shortcuts, visible save controls, validation, duplicate-submit prevention and retained input after failure. Dates reuse the existing America/Chicago business-day convention.
- Profile emails share one loader. Opening the email view exposes loading, retry, actual empty results and historical messages without a provisional zero tile. Responses for a previously selected profile are discarded.
- Profile and full-workspace Assistant views share a mounted conversation controller. Composer/draft state and request guards survive layout changes. Explicit profile/general/multiple-profile scope is visible and captured with message submission.
- Accepted scope persists transactionally for later messages; retries preserve the original run scope. A bounded fresh profile brief is supplied for single-profile runs. Opening the assistant does not create a model request.
- Daily navigation includes Assistant. Administration retains existing tool groups; older conversations and specialist tools remain available in More. Phone and foldable profile assistant views use full width, with a side panel at desktop width.

## Checks

- Focused frontend group: **12 files, 87 tests passed** (profile navigation, business dates, workspace routing, directory navigation, email state/history, primary actions, shared assistant controller and workspace behavior).
- Focused API group: **7 files, 35 tests passed** (scope validation, atomic submission/idempotency, profile brief, worker, workspace routes and spending guards).
- Additional final checks: follow-up dialog/workspace and session tests **7 passed**; mobile navigation and session review regressions **5 passed**; directory/Boss search/inline-edit checks **5 passed**. These groups overlap; do not sum them as unique tests.
- Frontend and API production builds pass. Frontend retains the existing large-chunk warning.
- Frontend typecheck: **133 diagnostics**, compared with **135** in the baseline capture. API typecheck: **94**, matching baseline. Comparing file, error code and message (ignoring shifted line numbers) found **no new diagnostics**.
- Broad frontend run during implementation: **1,932 passed, 182 failed**, across 519 files. It is not a green final-branch run: some intentional UI expectations and intermediate regressions were corrected afterward and verified in the focused runs above. Five representative failing files were rerun against a clean archive of the unchanged base: **18 failures reproduced**, including existing profile-page mock, assistant drawer, call queue and directory copy failures.
- Broad API run encountered many unrelated schema/migration/source-contract failures and was stopped after approximately 16 minutes; no complete aggregate result is claimed. Focused assistant API checks pass.

## Browser evidence

Local production build with a separate in-memory fixture API; no real profiles, emails, follow-ups or paid model calls were changed. Checked phone (390px), foldable (768px), and desktop (1440px) layouts. Verified full profile actions; centered follow-up dialog via direct action and legacy link; Tomorrow selection, save and immediate refreshed due date; email view; profile scope; unsent composer preserved on expand/back; Escape close and restored mobile focus; visible mobile workspace navigation. Browser review prompted a full-width panel below 1024px and collapsed setup/spending/offline controls in the profile panel.

## Context size

Deterministic oversized fixture: full serialized fixture **1,400,730 characters**, brief **3,989 characters**, enforced limit **4,000**. This is a stress fixture, not measured live token or dollar savings. The DB integration test covers bounded activity reads, source identity, fresh record changes and retired-profile rejection. General and multiple-profile requests do not eagerly load profile briefs. Full email/document bodies remain on-demand through existing tools.

## Independent review and resolved findings

A fresh read-only reviewer identified scope falling back after a completed run, mobile navigation stacking, and duplicate controllers when reopening an associated conversation. All three were fixed and re-reviewed. A subsequent focus-restoration issue on inert mobile content was fixed using post-commit focus restoration and checked in-browser. The reuse regression now asserts the visible textbox is the same DOM node.

## Implementation substitutions and remaining limits

- Reused the isolated clone. Used one profile email hook passed into its view instead of a new private query cache.
- Kept the established conversation engine mounted above routes instead of extracting a second state controller. This preserves existing draft review, request reconciliation, spending and offline behavior.
- Direct UI scope accepts profile IDs/year only. Related booking/thread/draft/batch references must continue through existing authorized server tools; client-injected related references are rejected.
- Added transactional `scoped-submit` PGlite tests instead of the proposed separate scope route test file. Existing workspace route tests cover legacy requests. Some planned filenames did not exist; existing worker and context checks were used.
- Live Gmail matching/OAuth, real model output, physical-phone keyboard behavior and production data were not exercised. This is a draft review candidate, not a deployment or claim that the repository-wide test suite is green.

## Header clipping follow-up

The full Assistant workspace now measures the visible app header and follows its height as Incoming Calls changes. A resize observer updates the offset when the header changes size.

At 1299×621 with Incoming Calls enabled and off, the header was 151px tall and the workspace began at 151px; the call control ended at 140px. The focused session suite passes (4 tests), the frontend build passes, and typecheck reports no diagnostics in the changed files.
