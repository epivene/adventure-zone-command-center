# Editable Call Scripts Design

## Goal

Let the Command Center owner edit the wording used by the guided Call Workspace without changing code, while keeping the branching logic, dispositions, follow-ups, Do Not Call handling, Last Resort handling, and save behavior protected from accidental edits.

## Product decisions

1. The editor lives under **Menu → Settings → Call scripts**.
2. The owner can edit the visible **Say this** text and optional **Coaching tip** for each guided script step.
3. Response buttons and their branch destinations are not editable in Release 1.
4. Script kinds remain: First outreach, Past customer / rebooking, Follow-up, Proposal / contract, Requested callback, and Incoming inquiry.
5. The existing hard-coded Adventure Zone script graph remains the canonical default.
6. Persistent database rows store only overrides. Resetting a step deletes its override so the code default immediately becomes authoritative again.
7. Overrides are global for the business and apply on every device/browser after save.
8. The editor shows a **Customized** badge whenever a step differs from the default.
9. The editor provides quick insertion buttons for supported placeholders instead of requiring the owner to remember template syntax.
10. The editor provides a preview rendered with sample contact/event data before saving.

## Supported placeholders

Release 1 supports the placeholders already trusted by the Call Workspace:

- `{{contactName}}`
- `{{eventName}}`
- `{{eventDate}}`
- `{{location}}`
- `{{packageInterest}}`

Unknown `{{...}}` tokens are rejected on save so a typo cannot silently appear on a live call.

## Data model

Create `call_script_overrides` with one row per `(script_kind, node_id)`:

- `script_kind text not null`
- `node_id text not null`
- `say_text text not null`
- `coach_text text null`
- `updated_by text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- primary key `(script_kind, node_id)`

The table deliberately does not store response buttons, branch ids, dispositions, next actions, or other workflow behavior.

## API

Owner-authenticated endpoints live with the existing Settings API:

- `GET /api/settings/call-scripts`
  - returns all override rows.
- `PUT /api/settings/call-scripts/:scriptKind/:nodeId`
  - validates known script kind/node id and editable text.
  - upserts one override.
- `DELETE /api/settings/call-scripts/:scriptKind/:nodeId`
  - removes one override and restores the code default.

`GET /api/calls/workspace` also returns the current override set so the live workspace renders the same configuration as the editor.

## Validation

- `sayText` is required after trimming and capped at 2,000 characters.
- `coachText` is nullable and capped at 2,000 characters.
- Only the six known guided script kinds are accepted.
- Only node ids from the protected code-default graph are accepted.
- Only the five supported placeholders are accepted in `sayText`.
- Saving text identical to the default is allowed but the UI should normally offer Reset instead; server persistence remains deterministic.

## Frontend editor

Route: `/settings/call-scripts`

Layout:

1. Header explaining that wording is editable but response behavior stays protected.
2. Script-kind selector.
3. One card per node in that script, in a stable conversational order starting with the opening.
4. Each card shows:
   - step label/node id in small text
   - Customized badge when overridden
   - Say this textarea
   - Coaching tip textarea
   - placeholder insertion buttons
   - Preview block
   - Save changes
   - Reset to Adventure Zone default when customized
5. Save/reset feedback is shown inline and does not navigate away.

The editor is mobile friendly: cards are one column, controls are full-width where useful, and no drag/drop is required.

## Live Call Workspace integration

The frontend keeps the complete safe default graph in `guided-call-scripts.ts`.

A pure merge helper can create the visible configured script by replacing only `say` and `coach`; all response objects remain references to the code-default graph.

`CallWorkspacePage` receives overrides in the workspace API payload and provides them to the visible guided-script card. The **call state/branch engine intentionally continues to use the raw code-default graph** for initialization, script-kind changes, response branching, and draft reset. Because response labels/ids/destinations are not editable, the rendered wording and the protected state graph remain aligned while custom text can never become executable workflow configuration.

## Schema lifecycle

Use a small feature-owned idempotent schema initializer for `call_script_overrides`, with a module-level single-flight promise so `CREATE TABLE IF NOT EXISTS` runs at most once per API process. Add the initializer to post-listen database maintenance so Render can bind the port first and the feature table is normally ready before user traffic. If post-listen maintenance fails, the repository can still retry schema initialization on first access.

## Safety and compatibility

- No script edit can change a call outcome or branch destination.
- The state/branch engine never consumes database-provided workflow structure.
- Existing saved drafts remain compatible because drafts persist script kind/state data, not editable text.
- Unknown/removed node overrides are ignored by the live merge and can be cleaned manually later.
- If the settings database read fails while loading a call, the workspace should fail in the existing API error path rather than silently presenting stale customized wording as authoritative.
- Existing default scripts remain usable when there are zero override rows.

## Release 1 exclusions

- Editing response button labels.
- Editing branch destinations or adding/removing branches.
- Per-user, per-leg, or per-event script variants.
- AI-written scripts inside the editor.
- Version history/rollback beyond Reset to Adventure Zone default.
- Import/export of scripts.
