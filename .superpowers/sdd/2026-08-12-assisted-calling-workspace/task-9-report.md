# Task 9 report: mobile call logging and profile entry points

## Base and scope

- Authoritative repository/ref: `epivene/adventure-zone-command-center` at `1b15762db69d9fd1d6eefe3c75ade07e47df219c` (`agent/assisted-calling-workspace`).
- Scratch implementation checkout: `/workspace/scratch/fd194ce465dc/task8-repo`.
- The scratch checkout began as an older mixed baseline, so missing/non-Task-9 frontend files were aligned from the connector ref before the final integration checks.

## TDD evidence

RED:

- `node_modules/.bin/vitest run src/pages/MobileCallLogPage.test.tsx`
- Failed because `./MobileCallLogPage` did not exist.
- A later event-profile regression failed when selecting a second, suppressed caller because suppression was still tied to the first caller.

GREEN:

- Focused mobile/profile tests cover caller lookup, incoming default, absence of recording/transcription copy, shared `mobile_log` completion payload and request key, exact profile URLs, DNC behavior, and switching between event contacts.
- Shared `CallWorkspace` regression coverage was included to ensure desktop/compact behavior and the mobile device Call action remained intact.

## Implementation

- Added `/calls/log` and `MobileCallLogPage`.
- Reused `CallerFinder`, `/calls/workspace`, `CallWorkspace`, draft recovery, follow-up fields, DNC confirmation, and `completeCallAction` (`/calls/complete`) rather than introducing a second save path.
- Mobile mode starts the form immediately, defaults Direction to Incoming, remains user-selectable, and always saves `method: "mobile_log"` even if the device Call action is used.
- Mobile mode requests no microphone/audio permission and makes no recording, transcription, or voicemail-delivery claim.
- Added exact **Call** and **Log call** actions on contact/event profiles. Event links preserve organization, selected contact, booking, and optional follow-up context.
- DNC numbers remove direct `tel:` entry points; profile Call is disabled while **Log call** remains available. Event suppression is keyed per contact and follows caller selection.
- Desktop/full and compact call-workspace behavior remains on the pre-existing branches; the mobile-only defaults/copy are gated by `mode === "mobile"`.

## Files changed for Task 9

- `artifacts/adventure-zone/src/App.tsx`
- `artifacts/adventure-zone/src/pages/MobileCallLogPage.tsx`
- `artifacts/adventure-zone/src/pages/MobileCallLogPage.test.tsx`
- `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`
- `artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx`
- `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`
- `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`

The two shared component edits are required to keep one save/draft implementation while providing mobile defaults and per-selected-contact DNC suppression.

## Verification

- Focused + shared regression command (direct package binary equivalent of the requested pnpm exec):
  - `node_modules/.bin/vitest run src/components/calls/call-workspace.test.tsx src/pages/MobileCallLogPage.test.tsx src/pages/ContactDetailPage.test.tsx src/pages/EventProfilePage.test.tsx`
  - Result: `4 passed`, `24 passed`, exit 0.
- Requested package typecheck was run through the installed TypeScript binary because the managed pnpm wrapper attempts to create `/root/.local`, outside the writable sandbox:
  - `node ../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
  - Result: exit 2 with six pre-existing/non-Task-9 diagnostics in `activity-repository.ts`, `contact-repository.ts`, and `OrganizationsPage.tsx`. No Task-9 file produced a diagnostic. This full-package gate therefore remains red in this scratch state and must be rerun after the upstream baseline diagnostics are resolved/integrated.
- Connector combined status for base commit `1b15762d`: no CI status contexts were present. No Task-9 commit was pushed from this subtask checkout, so there is no Task-9 CI run to cite.

## Commit status

- Applied through the GitHub connector without using the dirty local checkout.

## Remote application evidence

- Starting branch head: `1b15762db69d9fd1d6eefe3c75ade07e47df219c`.
- Starting tree: `ff8c3b54edee67c023b54a554a80215d683ffb21`.
- Task 9 implementation commit: `18b29355a956ada3aef7b27274e06b4088011a9d` (`feat: add mobile call logging`).
- Implementation tree: `d856220cad869c6cecf4505717f607ef1dc29f8c`.
- The branch ref was advanced with a non-forced fast-forward update.
- Connector fetches after the ref update verified all nine remote blobs exactly matched the tested local Git blob hashes:
  - `App.tsx`: `45627f9389fd362a475d9a0ab25463c83e2f0c37`
  - `call-workspace.tsx`: `c73d9242697d15b0e4f3101aab82595b5a0ede2b`
  - `event-profile-workspace.tsx`: `1ba4ad33ec065e2312fea01884dcd78ffb8234a7`
  - `ContactDetailPage.tsx`: `038f8811d944c20a8c404485ea31e5551cefd43c`
  - `EventProfilePage.tsx`: `fc075be0bdce9d7b8dadec15a1df1fa160c96ac7`
  - `MobileCallLogPage.tsx`: `7d3fb818f652b7afad9830fa6a8b2271301e75c7`
  - `MobileCallLogPage.test.tsx`: `73cb2275b00287b59a571d200ca651346fb4e316`
  - `ContactDetailPage.test.tsx`: `7f6bad4ee3471309afca3cc5b4329cdd6b9bd7de`
  - `EventProfilePage.test.tsx`: `0063b48b356114e49473c00597c9bdfb889acbad`

## Fix round 1: phone-level suppression and mobile draft continuity

TDD RED:

- Added event-profile regressions for mixed phone-level DNC state and contact-detail load failure. The focused run failed because the direct action still used the profile phone (`tel:3035550100`) instead of the authoritative callable detail phone, and a failed detail fetch still exposed direct Call actions.
- Added mobile regressions for persisting the selected caller/context in `/calls/log` and discarding a draft without returning to the Start gate. The focused run failed because selecting a caller did not update the URL and discard cleared `startedAt`/`requestKey`.
- One draft fixture initially used an incorrect storage prefix; it was corrected to the existing `assisted-call-draft:` contract before changing production behavior.

TDD GREEN and regression verification:

- `node_modules/.bin/vitest run src/pages/MobileCallLogPage.test.tsx src/pages/EventProfilePage.test.tsx`
  - Result: `2 passed`, `10 passed`, exit 0.
- `node_modules/.bin/vitest run src/components/calls/call-workspace.test.tsx src/pages/MobileCallLogPage.test.tsx src/pages/ContactDetailPage.test.tsx src/pages/EventProfilePage.test.tsx`
  - Result: `4 passed`, `28 passed`, exit 0.
- `node ../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`
  - Result: exit 2 with the same six baseline diagnostics in `activity-repository.ts` (3), `contact-repository.ts` (2), and `OrganizationsPage.tsx` (1). No Task 9 file produced a diagnostic.

Fix implementation:

- Event profiles now resolve a callable number from authoritative phone details per selected contact, prefer the primary non-DNC number, gate the exact number, and fail closed for direct Call actions when detail loading fails. **Log call** remains available.
- Caller selection now replaces the `/calls/log` URL with `contactId` and any organization, booking, or follow-up context so refresh restores the selected workspace.
- Mobile-only draft discard immediately creates a fresh timestamp/request key and keeps the workspace usable; desktop behavior remains unchanged.

Remote application:

- Fix-round starting head: `364f29c2d642d52700220495757746a530108ed7`.
- Fix implementation commit: `8697bd22f328dbbc25565213903293727c5ee802` (`fix: harden mobile call logging`).
- Fix implementation tree: `d3069157b59672f3fe1dde4e5d335f509fe67676`.
- The branch ref was advanced through the GitHub connector with a non-forced fast-forward update; the dirty scratch checkout was not pushed.
- Connector reads verified the six remote implementation/test blobs exactly matched the tested local content:
  - `MobileCallLogPage.tsx`: `f48395c564c7274ae76f42417ba3bc9f2fb7a91a`
  - `MobileCallLogPage.test.tsx`: `e81f8d7d1fd2718674ffc985fb73d51c03fc6f8a`
  - `EventProfilePage.tsx`: `810e1a1baa17c9a3de0bc29d7fd490344e56f959`
  - `EventProfilePage.test.tsx`: `65580f0bc583bac55527408a0fdaa99f671e13c6`
  - `call-workspace.tsx`: `599b18f92c9c539d55963b3ef03342b9a9e6a6bd`
  - `event-profile-workspace.tsx`: `13dfc643959e338a43f70ebcd8c5c83ccd300633`
