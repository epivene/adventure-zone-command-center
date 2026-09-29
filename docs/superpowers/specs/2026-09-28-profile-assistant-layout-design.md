# Adventure Zone: profiles, assistant, and admin layout

Status: direction approved; written design ready for review.

## Outcome

Make everyday profile work easy to find and complete. Open profiles fully, offer one consistent assistant from profiles and the general workspace, replace the misleading email count, and make follow-up scheduling immediately visible. The user approved this direction on September 28, 2026.

This design is grounded in `epivene/adventure-zone-command-center` at `cb32da44f3801a8a432b43b63233bab5171d02dc`. Implementation must recheck main before editing.

## Current behavior

- `organization-list.tsx` opens `ProfileDetailSheet`; the full profile is a separate navigation step.
- `EventProfilePage.tsx` registers profile context with the older assistant and renders `SimpleFullProfile`, followed by additional tools. The shared app shell also launches that assistant, while `AssistantWorkspacePage.tsx` offers a separate conversation experience.
- Add follow-up links to `?action=follow-up`. This expands More profile tools farther down the page, where `EventProfileWorkspace` renders the form. Its date entry is plain YYYY-MM-DD text; another editor uses a native date input and UTC conversion.
- The full-profile email counter starts with an empty array and resets to that on errors. It reads `conversations`, while the shared email hook also incorporates `historicalConversations`. Zero therefore cannot reliably communicate the state of email history.
- The newer workspace already has structured profile selections, bounded conversation history, source retrieval, and model-context deduplication. Its strict message schema currently has no explicit selection field, so profile-to-workspace context needs a validated handoff.

## 1. Full profiles and a simpler header

Selecting a profile in the admin directory opens its full `/profiles/:id` page directly. Contact-specific links preserve the selected contact. Existing booking, follow-up, and research deep links remain functional. Directory multi-selection controls continue to select records without navigating.

Back returns to the originating list with search, filters, sort, page, and scroll position restored. Store a validated app-relative return path and scroll position alongside the existing origin label; fall back to Profiles for direct links. Browser Back works naturally.

The profile starts with its name, location, primary contact, and next follow-up. Put the frequently used actions together: **Follow up**, **Open emails**, **Add note**, and **Assistant**. Call remains available beside the phone number. Put editing, research, family membership, special flags, and other occasional tools in a consistently labeled More menu.

Use labeled sections for Overview, Contacts, Bookings, History, and Documents. Overview contains the next action and recent activity. Existing invoices, contracts, booking creation, source material, and advanced tools remain reachable in the relevant sections instead of preceding the profile identity or duplicating action rows. Keep the current visual theme. This change does not redesign Dave's or manager permissions.

## 2. One assistant, two ways to view it

Use the newer assistant workspace conversation engine for the admin experience. Extract its conversation controller and reusable chat view so the same conversation can appear beside a profile or on the full workspace page. Both views share messages, drafts, results, model choice, and run status. Expanding or collapsing the view does not create a conversation or resubmit a message.

On desktop, Assistant opens a side panel that leaves the profile usable. On narrow screens it opens a full-height sheet with a clear Back to profile control. The general workspace keeps its full-page layout and profile search/selection. Use one global Assistant entry and the contextual profile button; remove competing generic Booking Assistant launchers from the admin shell.

Keep specialist capabilities, such as lead scouting and call assistance, reachable as named tools where still needed. Retain access to old conversation history through an Older conversations entry. Do not automatically merge old conversations or remove underlying specialist services in this cleanup. Boss and manager assistant behavior stays within its existing role boundaries.

### Context handoff

Opening Assistant from a profile sets a visible **Working with: [profile name]** scope. A new profile conversation starts with that profile ID; returning to its associated conversation resumes it. General workspace conversations can select one or multiple profiles and can explicitly clear selection to General workspace.

Add a backward-compatible, optional validated selection snapshot to the message request. The server authorizes the referenced records and captures the effective selection atomically with the user message and run. Requests without that field retain existing behavior. Reconciliation/retries reuse the original snapshot and never retarget an already accepted message. Show the effective scope in the conversation response.

Changing profiles clears incompatible booking, email-thread, draft, and batch selections. It cannot retarget an in-flight run or overwrite an unsaved draft. Preserve pending work with its original conversation and show that conversation's scope. A general or multi-profile conversation is not silently converted into a different profile conversation by navigation. Scope labels remain visible before sending.

### Token use

Pass IDs and a small server-built profile brief, not the rendered page or entire history. The initial brief includes identity, primary contact, next open follow-up, and a limited recent-activity summary. Cap serialized brief text at 4,000 characters and identify omitted material. This is a design budget, not a claimed token saving.

Fetch specific notes, bookings, documents, and email bodies only when needed. Reuse the existing bounded conversation context and evidence deduplication. Retrieve current versions when saved profile data changes; retain source IDs and completeness information so a short summary never implies that the whole record was reviewed. Display existing usage/cost information. Measure representative requests before and after; report actual usage without promising a percentage reduction.

## 3. Profile emails

Replace the numeric email tile and competing summary entry points with **Open emails**. It opens the profile's email section and brings that section into view. `?section=emails` continues to work.

Use one shared email query/state per active profile to display current and historical matched conversations and saved drafts. Distinguish Loading, Failed with Retry, Loaded with results, and Loaded with no matched conversations. A failed request cannot display a successful empty state. Late responses from a previous profile cannot update the current profile.

Keep composing available inside Emails. Preserve existing association, review, and correction functions; changing the entry button does not claim to repair email matching. Validate known linked-thread fixtures through the existing API and report any separate matching defect found during implementation.

## 4. Follow-up scheduling

Follow up opens a portaled dialog centered in the viewport, or a full-height sheet on small screens. It opens immediately regardless of page scroll. The existing `action=follow-up` deep link opens this same dialog once; closing it clears that action from the URL without losing other context.

Show the profile/contact, follow-up type, and due date together. Provide a keyboard-accessible calendar with month/year controls, a readable editable date field, and Today, Tomorrow, and Next week shortcuts. Show the selected date in words. Use the same picker for creation and editing.

Use a shared date conversion for both paths. Interpret date-only selections in the existing business timezone, America/Chicago, and serialize at local noon through the existing timestamp API. Shortcuts use calendar-day arithmetic in that timezone, including daylight-saving transitions. Do not rewrite existing stored timestamps; preserve their business-calendar date when editing. Reject impossible dates and show a field-level error. Planning inspection corrected the earlier Denver assumption: both frontend and server `lib/business-date.ts` use Chicago, and the active queues depend on that policy. Reuse those helpers and correct the inconsistent profile display rather than changing scheduling policy.

Save remains visible with an onscreen keyboard; focus is trapped appropriately and returns to the opener on close. Disable duplicate submission while saving. On failure keep the entered values and display the error. On success close the dialog and refresh the visible next-follow-up state and active queues. Preserve existing rules governing active follow-ups and completion outcomes. Edit uses the same dialog; destructive actions stay in More.

## 5. Admin navigation

Keep everyday destinations together: Today, Profiles, Schedule/Bookings, Email Review, and Assistant. Put setup and maintenance under Administration with the existing groupings for Connections, Business setup, Data/imports, and System. Keep daily document and invoice work reachable from its workspace and profile sections. Preserve existing routes and authorization. Mobile navigation uses the same labels and a More menu for overflow.

## Implementation boundaries

Primary areas are the organization list and profile navigation helper; `EventProfilePage`, `SimpleFullProfile`, and profile action components; shared follow-up dialog/date controls; profile email hook/panel; admin shell/menu; and reusable assistant workspace controller/view plus server request validation and run scope capture.

Use existing conversation and record APIs wherever possible. Introduce no automatic email sends, new provider, wholesale CRM migration, or role expansion. Historical assistant conversations remain accessible. Existing draft review, spending controls, offline preparation, and action confirmation behavior must survive the shared view refactor.

## Acceptance and verification

1. One click opens a full profile from the directory. Back restores a filtered, paginated list and its scroll position. Multi-selection still works.
2. All four primary profile actions are visible on desktop and phone layouts without opening More.
3. Follow up opens onscreen from the top or bottom of a long page and from an old deep link. Create/edit retain the intended calendar date across timezone and daylight-saving test cases. Failed saves retain input; successful saves refresh the next action.
4. Open emails never presents a provisional zero count. Loading, errors, historical conversations, drafts, and genuine empty results are covered. Rapid profile changes cannot mix email results.
5. A profile question reaches the server with exactly that authorized profile selection. Switching profile, clearing scope, multi-profile workspace use, reload, retry, and concurrent run cases cannot silently change an accepted request's target.
6. Expanding a profile conversation to the workspace preserves its identity, messages, unsaved composer/draft state, and in-flight request. Collapsing back produces no duplicate request.
7. Token-context tests enforce the brief bound and source deduplication. Representative captured requests compare context size and available usage metrics; no live paid model call is needed for deterministic behavior tests.
8. Focused frontend and server tests cover these behaviors, followed by project typecheck/build with pre-existing failures clearly separated. Browser checks cover a long scrolled profile, keyboard navigation, a narrow phone viewport, a wider foldable viewport, and desktop. Use fixtures for writes; do not alter real follow-ups merely to test the UI.

## Review state

The user approved the overall direction. This written design is the next review artifact. After approval, create the implementation plan and execute using the agreed method. No product code has been changed for this design.
