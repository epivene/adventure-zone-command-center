# Map, Manager Login, and Manager Password Reliability

**Date:** 2026-08-15

## Goal

Fix three production issues discovered during live verification:

1. Route events geocode successfully but the map renders as a blank gray canvas.
2. After signing out of the owner/admin app, there is no obvious path into the Leg Manager Portal, causing manager passwords to be submitted to the owner login endpoint instead.
3. Two managers can currently be assigned the same password.

## 1. Real Basemap and Event Auto-Fit

The current route map must stop relying on a Next.js-style environment variable inside the Vite frontend and must not use a blank background-only fallback as the normal map experience.

### Map style

- Read the map style from a Vite-compatible environment variable such as `import.meta.env.VITE_MAP_STYLE_URL`.
- If no custom style is configured, use a real public MapLibre-compatible basemap style rather than a blank gray style.
- The fallback must show normal geographic context such as roads, cities, state boundaries, or comparable base-map information.
- A style load failure must show a visible map error instead of silently leaving a blank gray canvas.

### Event visibility

When mapped events or approved/suggested handoff markers are available:

- Automatically fit the map viewport to the visible marker bounds after map load and when the visible dataset changes.
- For one marker, center on it and use a useful city-level zoom.
- For multiple markers, fit bounds with padding.
- Manual zoom/pan remains available after the automatic fit.

A booking such as Eastern Montana Fair in `Miles City, MT` that already reports as a mapped event must visibly produce a map marker.

## 2. Public Sign-In Choice

The signed-out landing experience must clearly distinguish the two authentication systems.

Present two choices:

- **Admin / Command Center** → `/sign-in`
- **Manager Portal** → `/manager/sign-in`

The manager path must not route through the owner/admin password screen.

Manager sign-in continues to require:

- Manager/leg selection.
- That manager/leg's configured password.

The owner/admin sign-in flow remains unchanged otherwise.

## 3. Unique Manager Passwords

Manager passwords must be unique across manager/leg accounts.

### Rules

- When enabling a manager portal or changing its password, compare the candidate password against every other configured manager access record.
- Include archived manager/leg records in the uniqueness check so an old password cannot accidentally be reused by another manager.
- Exclude the current manager/leg when changing its own password, so saving the same current password does not falsely conflict with itself.
- Passwords remain salted/hashed and are never stored or logged in plaintext.
- Comparison is performed by verifying the candidate plaintext against each stored hash/salt using the existing password verification function.
- If another manager already uses the password, reject the update with HTTP `409` and user-facing copy such as: `That password is already assigned to another manager. Choose a different password.`
- Do not expose which manager owns the conflicting password.

## 4. Error Handling and Diagnostics

- Map-style load errors are visible in the Routes UI.
- Manager login errors remain distinct from owner/admin login errors.
- Duplicate-password rejection is shown inline in the unified Manager / Leg card without clearing unrelated leg edits.
- No plaintext manager password is added to logs, API responses, database audit payloads, or UI state beyond the temporary write-only input.

## 5. Compatibility

Do not remove or change:

- Existing manager session-version invalidation.
- Existing manager token format or expiry.
- Existing owner/admin password behavior.
- Existing city/state geocoding and `Location needs mapping` retry behavior.
- Existing finance, receipts, trips, equipment handoffs, route filters, or manager/leg IDs.

## 6. Testing

Automated coverage must include:

### Map

- Vite map-style configuration is used when present.
- A real fallback style is selected when configuration is absent.
- One mapped Miles City event causes the map to center/zoom to its marker.
- Multiple mapped events cause bounds fitting.
- Map-style failure produces visible error UI.

### Sign-in

- Signed-out landing renders both Admin / Command Center and Manager Portal actions.
- Manager Portal navigates to `/manager/sign-in`.
- Manager sign-in submits to `/api/manager/auth/login`, never `/api/auth/login`.

### Unique passwords

- Setting a manager password that matches another active manager returns `409`.
- Matching an archived manager's password also returns `409`.
- A distinct password succeeds.
- A manager may retain its own current password without a false duplicate conflict.
- Password uniqueness checks never expose plaintext or another manager identity.

## Acceptance Criteria

The change is complete when:

- The live Routes map shows a real basemap instead of the blank gray canvas.
- Eastern Montana Fair / Miles City is visibly marked when the Routes UI reports it as mapped.
- A signed-out user can clearly choose either Admin / Command Center or Manager Portal.
- Manager credentials are sent only to the manager login endpoint.
- Two different manager/leg accounts cannot share the same password.
- Existing route, manager, finance, receipt, trip, and handoff functionality remains intact.
