# Guided Calling Console Design

**Date:** 2026-08-19  
**Status:** Approved in conversation  
**Builds on:** `docs/superpowers/specs/2026-08-12-assisted-calling-workspace-design.md`

## Summary

Extend the existing assisted calling workspace into a Five9-style guided calling console. Starting a call from Today or a profile should both launch the configured phone handler and open the shared in-app workspace for that exact contact/event. The workspace should explain why the call is happening, summarize the relevant CRM context, guide the user through a branching clickable script, capture notes and outcomes, and prepare the next follow-up without creating a second calling subsystem.

The user is the Adventure Zone administrator. The assistant must not escalate unknown questions to an admin. Instead, it should answer from trusted Adventure Zone/CRM context when possible and otherwise save the unresolved item into a **Needs Answer** queue for the user to resolve later.

## Goals

- Add a compact phone action to actionable Today items.
- Make one click both select/open the correct call workspace and launch the phone handler.
- Keep Today as the main outbound calling queue.
- Generate a concise call briefing from existing CRM data before the user speaks.
- Select the correct script based on previous contact history, booking status, follow-up reason, and event context.
- Replace flat scripts with deterministic clickable response branches.
- Let script choices prepare suggested notes, outcomes, and follow-up actions without saving them automatically.
- Preserve manual notes, call history, dispositions, draft recovery, multiple phone numbers, Do Not Call suppression, Last Resort behavior, and existing Phone Link / `tel:` launch behavior.
- Provide an **Ask Assistant** escape hatch for questions outside the scripted branches.
- Save unresolved assistant questions to a **Needs Answer** queue owned by the user.

## Non-goals

- Do not replace the existing assisted calling subsystem.
- Do not require Five9 or another cloud dialer.
- Do not claim the browser can detect whether Phone Link answered, connected, or ended a call.
- Do not automatically save a disposition merely because a script response was clicked.
- Do not let AI invent pricing, package contents, legal commitments, availability, or business policy.
- Do not add call recording or live audio transcription in this release.
- Do not create a second admin/escalation role for unresolved questions.

## Primary call flow

1. The user sees a call-worthy item on Today.
2. A small phone icon is available directly on the Today item/card.
3. Tapping the phone icon selects the contact/event and opens the existing shared Call Workspace in the Today calling area.
4. The same action launches the selected phone number using the existing phone-launch adapter / `tel:` URL.
5. The workspace immediately shows:
   - Who is being called.
   - Why this call is due.
   - Booking/contact status.
   - Event date and location when known.
   - Route leg when known.
   - Package interest when known.
   - Last contact date and previous outcome.
   - A short summary of important prior notes/history.
   - The recommended opening script.
6. The user reads the opening and clicks the caller's response.
7. The script branches to the next recommended prompt and may populate a suggested CRM outcome or follow-up action.
8. The user can override any suggestion, type notes, set the outcome, and save through the existing call completion flow.
9. On save, the existing call history/follow-up logic remains authoritative.

## Today phone action

### Placement

Add a small, clearly labeled/titled phone icon to Today items that have a callable contact number. It must be reachable without first opening the full profile.

### Behavior

`Start guided call` must perform two coordinated actions from the same user gesture:

- Set the selected Today call context so the shared call workspace opens with the correct contact/event/follow-up.
- Invoke the existing phone launcher for the selected number.

If the browser/OS prevents the `tel:` launch or there is no callable number, the workspace still opens and offers the existing Copy Number / number selector behavior.

The button must not create or complete a call record merely by being clicked.

## Call briefing

Add a deterministic briefing assembler to the existing workspace payload. It should favor structured data over AI-generated interpretation.

### Briefing fields

- `reason`: first outreach, follow-up, proposal/contract follow-up, callback, past-event rebooking, incoming inquiry, or generic follow-up.
- `headline`: short human-friendly summary such as `Follow up on proposal`.
- `status`.
- `eventName` / organization.
- `eventDate` and location.
- `routeLeg`.
- `packageInterest` if stored.
- `lastContactedAt`.
- `lastOutcome`.
- `keyFacts[]`: a bounded set of useful facts from structured CRM state and recent activity.
- `historySummary`: concise summary of recent relevant history; when no trustworthy summary exists, fall back to recent history snippets rather than fabricating one.

### Relevance rules

Prefer recent, call-relevant information. Do not flood the workspace with every ACT note or profile field. The target is enough context to avoid rereading the whole profile while the phone is ringing.

## Guided branching scripts

### Design principle

The main script engine is deterministic, data-driven, and editable in code/config. AI is not the source of truth for business promises.

### Script kinds

Initial script families:

- First outreach.
- Past customer / rebooking outreach.
- General follow-up.
- Proposal or contract follow-up.
- Callback requested.
- Incoming inquiry.

### Node shape

Each script contains nodes with:

- Stable `id`.
- `say`: what the user can say next.
- Optional `coach`: short guidance visible to the user but not meant to be read aloud.
- `responses[]` representing likely caller replies.

Each response contains:

- Stable `id`.
- Button `label` such as `Interested`, `Need pricing`, `Already booked`, `Call back later`, `Not interested`, `Wrong person`.
- `nextNodeId` or terminal state.
- Optional suggested outcome.
- Optional suggested next action.
- Optional follow-up timing prompt.
- Optional facts/questions to collect.

### Example branch

`First outreach` → caller says `Need pricing` → pricing-safe response that references stored package information only → collect attendance/date/location if missing → suggest likely package only when rules/data support it → offer to send information/proposal.

`Already booked someone` → ask whether that is only for this year's event → if yes, suggest a future-season follow-up rather than marking the organization permanently declined.

`Call back later` → ask/choose a follow-up date and suggest `Follow-up needed` without saving until the user confirms.

### Personalization

Template placeholders may use trusted data already in the workspace, for example contact first name, event name, prior relationship, event date, and known package interest.

A past customer should not receive a cold-call opening. A proposal follow-up should not restart discovery from zero.

## Suggested CRM actions

Script responses may stage suggested state in the existing call draft:

- Suggested disposition/outcome.
- Suggested next action.
- Suggested follow-up date/time.
- Suggested note fragment.
- Missing facts to collect.

Suggestions are visibly marked and remain editable. Nothing is persisted until the user uses the existing Save/Complete Call action.

## Ask Assistant

The workspace includes a compact **Ask Assistant** action for questions that fall outside the current script.

### Trusted-answer boundary

The assistant may answer from:

- Current contact/event/organization CRM data.
- Existing package/business information available to the app.
- Approved scripts/business rules.
- Existing notes/history where relevant and permitted.

It must not invent unknown prices, availability, package details, contractual promises, or policy.

### Unresolved questions

If the assistant cannot answer confidently, it returns a clear `Needs Answer` result. The user may save that question to a small queue containing:

- Question text.
- Contact/event/organization context.
- Call session/follow-up context when available.
- Timestamp.
- Optional user note.
- Status: `open` or `resolved`.
- Resolution text when resolved.

Because the user is the administrator, no `send to admin` action exists.

## UI composition

On desktop, the existing call workspace should gain these sections in order:

1. Caller header + phone actions.
2. **Why you're calling** / briefing strip.
3. Guided script card with large tappable response choices.
4. Quick Facts / history summary.
5. Ask Assistant.
6. Notes.
7. Outcome / next action / follow-up controls.
8. Recent history, collapsible.

On mobile, keep the same logical order but use a single-column layout with sticky access to the current script response choices and Save/Complete actions where practical.

## Data and service boundaries

Extend the existing calls workspace query rather than add a parallel endpoint.

Recommended new focused units:

- `call-briefing.ts`: deterministic call reason + key facts assembly.
- `guided-call-scripts.ts`: script definitions and branching helpers.
- `guided-call-state.ts`: client navigation/staged suggestions for the current script path.
- `needs-answer` API/repository: unresolved assistant question persistence.

The shared `CallWorkspace` remains the composition point used by Today and profile entry points.

## Error handling

- If briefing data fails, the call workspace still opens with standard contact context.
- If a script cannot be selected, fall back to a generic follow-up script and allow manual script selection.
- If a script definition contains a broken branch, show the current prompt plus a `Use manual notes` fallback; do not crash the call workspace.
- If Assistant lookup fails, preserve the user's question and offer `Save to Needs Answer`.
- If saving a Needs Answer item fails, keep the text locally until retry/discard.
- Existing call draft recovery behavior remains intact.

## Testing

### Unit

- Call reason selection for first outreach, rebooking, follow-up, proposal/contract, callback, and incoming inquiry.
- Briefing fact prioritization and bounded output.
- Script selection from CRM context.
- Every script response points to a valid next node or terminal state.
- Script response suggestions do not persist automatically.
- Past-customer and proposal-follow-up scripts avoid cold-call/discovery resets.
- Needs Answer creation/resolution state.

### API/service

- Workspace payload includes briefing and recommended script kind.
- Existing workspace behavior remains compatible when guided fields are absent.
- Needs Answer items retain entity/call context.
- No unresolved-question path references a separate admin escalation.

### Component/workflow

- Today phone icon opens the correct workspace and invokes the launcher once.
- Today call click does not complete/save a call.
- Response buttons advance to the expected script node.
- Suggested outcome/follow-up appears but remains editable and unsaved.
- Manual script selector works when the automatic choice is wrong.
- Ask Assistant can return an answer or offer Save to Needs Answer.
- Mobile layout remains usable with touch-sized controls.

### Regression

- Multiple phone numbers and office extensions.
- Number-level Do Not Call suppression.
- Last Resort remains organization-level and separate.
- Draft recovery.
- Existing call completion idempotency and follow-up creation.
- Contact/event profile call entry points.

## Acceptance criteria

- A phone icon on Today can begin the full assisted workflow in one user action.
- Starting a call launches the selected number and opens the correct in-app workspace.
- The workspace tells the user who they are calling, why, and the most useful prior context before the conversation starts.
- The script changes based on contact/booking/history context.
- Common caller responses are clickable and branch to the next recommended wording.
- Script branches can stage, but never silently save, outcomes and follow-ups.
- The user can leave the script and take manual notes at any point.
- Unknown questions can be asked of the assistant.
- Unanswered questions can be saved to a Needs Answer queue for the user; there is no admin escalation action.
- Existing assisted-calling persistence, Phone Link launching, Today queue, contact history, follow-up logic, Do Not Call rules, and Last Resort behavior continue to work.
