# Direct connection verification

Implementation base: upstream main `fe7c14562cb0a3e903d32404e5d320200d65edef`, tree `cd8583b7a563e091e245859453af0e96bbb3fca0` (local verified snapshot `171dc987`). Disabled by default. No live records, deployment, account billing or messages changed.

## Verified locally

- Real SQL operation receipts: exact replay, conflict, rollback, connection isolation and revocation.
- Dedicated OAuth provider: encrypted artifacts, code + S256 PKCE, exact redirects, token audience/expiry/scopes, refresh rotation, reused-code rejection, grant revocation and late refresh writes.
- Owner routes require owner login, exact origin and session-bound CSRF for mutations.
- Bounded profile search/history; explicit incomplete sections/excerpts; current-version document cache and profile access checks; unavailable extraction does not start work.
- Sourced lead/note persistence, conservative duplicate review and stable identity across years.
- Concrete profile approvals: no mutation on proposal, exact owner-approved hash, 15-minute expiry, stale/merged/deleted/tampered rejection, single consumption and replay.
- App-only drafts with sanitized content and association/revision checks; existing follow-up service/repository behavior inside the operation transaction.
- MCP protocol discovery, scoped tool visibility/invocation, auth/host/origin/disabled/body limits.
- Real SQL MCP flow reads and saves notes/drafts/follow-ups, repeats writes, retrieves receipts, applies an owner-approved change, reloads saved drafts and rejects revoked access with app AI disabled and no model key. Import-boundary test excludes model/research/extraction/job dependencies from the service graph.
- Settings and consent DOM tests, read-only consent default, revoke action, no displayed credential, offline/reconnect draft visibility.
- API and UI production builds pass. Protocol packages are external dependencies so the app's Zod alias does not rewrite their own imports.

Focused backend selection: 59 passed, one explicitly skipped PostgreSQL concurrency test. UI connection selection: five passed. API/UI builds passed. Fresh-main and branch type checks report 95 API and 133 UI diagnostics respectively, with identical counts by source path/error code; no connection-file diagnostics. Textual differences are existing union ordering and App.tsx line shifts. Independent review disposition is recorded below before publication.

## Existing baseline failures

The unchanged canonical-children tests omit `eventDateFacts` and fail in the existing effective-date resolver (four cases). The unchanged single-active-follow-up PGlite fixture omits `organization_location_id` and fails insertion (one case). These are separate from the new connection's passing SQL coverage. Both failures were reproduced on the fresh-main checkout: five failing tests across those two unchanged suites.

## Release gates

- Run `concurrency.postgres.test.ts` with an explicitly disposable `TEST_DATABASE_URL`. No PostgreSQL server was available locally; the suite is skipped, not passed. It uses an isolated temporary schema and multiple connections to test duplicate creation, replay, approval application and refresh/revocation.
- Verify a real ChatGPT client/account supports the pre-registered OAuth client flow, metadata discovery, exact callback and tools. Dynamic registration is intentionally unavailable.
- Inspect actual UI at 360px and 768px and on the user's Fold/Android device, including owner-login return during OAuth consent. DOM tests do not prove physical-device layout. No local Chromium binary was available.
- The existing binary foam-party banner was unavailable through the text-only repository connector. Its upstream blob is preserved; it is not modified or deleted by this branch.
- Deployment, enabling the connection and live read/save checks require a separate release decision. Dot scheduling/shared leases are a second release.

## Independent review and fix pass

One fresh independent whole-branch review was completed. Three findings were graded Important and fixed in one pass; no Critical findings and no second review.

1. Separate API/static website hosting: a new integration test reproduced an unauthenticated preflight returning 401 instead of 204. Exact-origin owner CORS now runs before authentication; separate API and website origins are configurable. OAuth sends the browser to an API-hosted consent/login page, so its Secure/Lax interaction cookie stays first-party. A real provider authorization/consent/code round trip passes with different API/UI hosts. DOM tests check existing owner login, read-only defaults, exact scope submission, denial and rejection of an external authorization-resume URL.
2. Stable source identity: a SQL test reproduced duplicate profiles when a source URL stayed the same but name/location changed. Explicit event source identity now excludes mutable descriptive fields and retains query event IDs. General website fallback still includes event/location. Regression cases pass.
3. Old receipt targets: a SQL test reproduced 404 for a saved draft beyond the first 50 records. Owner-scoped detail and stable cursor pagination now cover drafts and proposals; Settings opens receipt query targets and supports older pages without duplicates. SQL and UI regressions pass.

Deferred Minor: Settings' last-used timestamp is updated for new mutations, not read-only or receipt/retry calls. It can therefore show an incomplete activity history. No data or authorization behavior depends on this display field.

## Decisions and limitations retained

- Used the refreshed main snapshot and GitHub tree/blob transport because no authenticated git remote was available. Remote publication overlays the actual upstream tree and preserves the unavailable banner blob.
- Used package-local binaries and isolated new dependencies because the existing dependency tree is symlinked. No repository-wide dependency/runtime upgrade.
- No model-key configuration is needed: reads and saves must operate without app inference. Import-boundary and real-service integration tests enforce that scope.
- Schema startup runs only with the connection enabled; this avoids adding a startup database dependency to disabled deployments. Existing grants can still be revoked after disabling.
- Provider/router composition was deferred from the authorization task until tool services existed; it is now mounted and covered, including split hosting.
- Bounded read projections reproduce current profile association predicates instead of loading an unbounded full-profile repository response. Association parity remains a maintenance obligation.
- General organization email changes are excluded because email belongs to contacts in the existing model; no inferred organizer/contact changes are introduced.
- App drafts use a dedicated external-draft table and Settings review location because assistant conversation drafts require AI message foreign keys. They are app-only drafts, not Gmail drafts. Existing follow-up domain rules run inside the operation transaction.
- Zod schemas use the SDK's Standard Schema adapter; maintained protocol packages are externalized in the API bundle to avoid the existing Zod alias rewriting their imports.
- Real client registration capability is unverified. Dynamic registration stays disabled; installation requires support for a registered client ID and exact callback.
- PostgreSQL multi-session and physical/browser layout checks remain release gates; PGlite/DOM tests are not substitutes.
- Five upstream fixture failures and existing type diagnostics are documented rather than repaired in this scoped change. Focused tests/builds pass; this is not a clean whole-repository test claim.
- The already-approved draft PR is the delivery target; no repeated integration-choice approval is needed. Deployment, enabling, billing, sends and live records were not changed.
- Dots, scheduling, shared task leases and code editing remain outside the first release. The reviewer did not assess those excluded capabilities, live-account/device behavior or unavailable PostgreSQL execution. Their limits are retained, not treated as successes.
