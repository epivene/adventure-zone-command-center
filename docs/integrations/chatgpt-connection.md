# Direct ChatGPT connection

This integration exposes bounded CRM reads and explicitly authorized saves. It makes no model calls, starts no assistant runs, launches no research/extraction jobs, and never sends email. ChatGPT plan limits and hosting/database charges are separate. The existing in-app assistant and its billing remain unchanged.

The release is disabled by default. Do not enable until the draft PR is reviewed, PostgreSQL concurrency tests pass, and an owner account can complete a real client installation.

## Server configuration

After approval, configure:

- `CHATGPT_CONNECTION_ENABLED=true` (leave unset/false until release approved).
- `CHATGPT_CONNECTION_ORIGIN`: exact API HTTPS origin, no path or trailing slash. OAuth issuer and resource server use this host.
- `CHATGPT_CONNECTION_APP_ORIGIN`: exact website HTTPS origin for Settings CORS/CSRF. Defaults to the API origin for same-host deployments. For the existing separate Render API/static website, set this to the website origin and keep `VITE_API_BASE_URL` pointed at the API.
- `CHATGPT_CONNECTION_ENCRYPTION_KEY`: base64-encoded cryptographically random 32 bytes; keep stable across deployments so stored OAuth artifacts remain readable.
- `CHATGPT_CONNECTION_COOKIE_KEY`: independent long random signing secret; keep stable.
- `CHATGPT_CONNECTION_JWKS`: a private signing JWKS with a stable RSA/RS256 signing key and unique `kid`. Treat it as a server secret.
- Existing owner login and session configuration must be valid.

No OpenAI model key is required by this integration. Never paste server secrets into chat or client registration. Rotation/recovery of the artifact key requires revoking affected grants and reconnecting; silently replacing the key breaks existing sessions.

Additive tables are installed during required startup only when enabled. Once tables exist, owner revocation remains available with the feature disabled. Re-enabling does not restore revoked grants.

## Installation and verification

1. In Command Center, open **Settings → ChatGPT connection**. Copy the endpoint shown there: `https://<configured-origin>/api/chatgpt/mcp`.
2. Use a ChatGPT client/account that supports installing a remote MCP connection with an owner-registered OAuth client ID. Obtain the exact HTTPS callback URI that client supplies. Client availability and callback details must be verified in the actual account; this release does not implement dynamic client registration.
3. Register the client name and exact callback in Command Center. Use the resulting client ID in the client setup. The client is public (`token_endpoint_auth_method=none`) and requires authorization code + S256 PKCE. Never substitute the legacy assistant-import token or owner login token.
4. Complete owner login and the provider-bound consent screen on the API host. Consent is served by the API so interaction cookies remain first-party even when the website is hosted separately. The page reuses `/api/auth/login`, holds the owner bearer only in memory, and never transfers it through a URL. Initially select only the read permission.
5. Ask for one existing profile by name, then read its history. Confirm the app link, pagination, recorded dates and unknown roles. This must not increase the app's AI usage ledger.
6. Authorize additional scopes only when needed. For a first save, append one owner-approved sourced note to a test profile with a unique request key. Retry that same request key and verify the original operation receipt and one saved record.
7. Revoke access in Settings and confirm further reads, writes and token refresh fail.

If the client cannot supply an exact registered client ID/callback, stop installation and record that compatibility gap; do not enable unauthenticated access or broaden registration. Android/Fold access is a release gate, not presumed available.

## Behavior

- Reads: default 20/max 50 search results; context pages stay below 24,000 serialized characters. Use section names and continuation cursors. Excerpts and omitted sections are explicit. Requested research year is not proof of an event that year.
- Documents: only owner-scoped saved text matching the current accepted blob hash and linked profile is returned. Missing/stale extraction returns `CONNECTION_EXTRACTION_UNAVAILABLE`; no paid extraction starts.
- Leads: an explicit event-specific source URL is stable even if the name/location is corrected, and query-based event IDs remain distinct. If only a general official website is available, normalized event/location are included to keep different events on a municipal website separate. Possible name matches require review. Organizer roles are never invented.
- Notes: source URLs, retrieval timestamps, event years and supplied verification labels are saved. The app does not claim independent verification.
- Updates: `read_profile_details` supplies About, all editable profile fields and a revision. Under existing owner-authorized `crm:update`, `save_profile_update` saves non-clearing name/category/About/website/phone/address/application-deadline/deal-preference edits directly. Exact revision, sources, reason, idempotent request key and before/after audit history are required. Non-About factual changes need supplied verified evidence; website evidence must match the target site. This does not independently verify research. Null/blank clearing is rejected; use `propose_profile_update` and exact owner app approval to remove information. Existing approval expires after 15 minutes and fails if the profile changes, is merged or deleted. Profile edits do not alter contact roles, bookings, prices or payment status.
- Duplicate merges: use the separate [merge preview and owner approval workflow](profile-merges.md). Both tools require `crm:update`; field-update approval does not authorize a merge. No CRM profiles are merged by preview alone.
- Drafts: stored under **Settings → ChatGPT connection → Saved app drafts**, visible even with in-app AI disabled. HTML is sanitized; UI displays plain text. Receipt links open the saved record even outside the first page; use Older drafts/Older proposals to continue browsing. These are not Gmail drafts and cannot be sent by this connection.
- Follow-ups: require explicit UTC/offset due time; owner-facing times use America/Denver. Existing booking reminder replacement behavior applies.
- Recovery: every mutation requires `requestKey`. After a network timeout, retry the identical request key to retrieve the committed result. Never create a new key merely because the response was lost. Receipts are connection-scoped.
- Limits: 256 KB MCP body, 60 requests/minute/connection shared in PostgreSQL, 5-minute access tokens, rotated refresh tokens with a 30-day absolute lifetime.

Shared task leases, dot handoffs, code editing and autonomous scheduling are outside this first release.

## Complete saved record readers

`list_app_records` and `read_app_record` extend the summary readers to full saved record content. Omit `profileId` to browse an entire owner-visible collection, or include it to restrict linked records. Supported sections are:

- `profiles`
- `contacts`
- `contact_phones`
- `locations`
- `bookings`
- `activities`
- `manager_reviews`
- `contract_drafts`
- `contract_versions`
- `contract_files`
- `contract_status_history`
- `coi_drafts`
- `invoices`
- `invoice_payments`
- `event_families`
- `family_notes`
- `organization_phones`
- `paper_notes`
- `attendance_history`
- `promotions`
- `documents`
- `document_links`
- `document_reviews`
- `document_history`
- `profile_edit_history`
- `email_threads`
- `email_messages`
- `email_files`
- `email_reviews`
- `followups`
- `event_dates`
- `research_runs`
- `convention_members`
- `research_sources`
- `research_suggestions`
- `convention_editions`
- `convention_history`

List pages default to 20, maximum 50, newest saved timestamp first. Each item has arguments for `read_app_record`. Join its JSON text chunks in offset order before parsing or interpreting a record; chunks are capped at 8,000 characters. Record hashes bind continuation to the same data; changed records require a fresh read. Lists and full reads check the active connection and `crm:read` every time. Missing deployment tables/columns report `availability=unavailable`, never an empty successful result.

These readers expose static reviewed data projections. They do not accept SQL, table names, arbitrary paths, or credentials. Storage object keys, OAuth refresh tokens and session/password tables are excluded. Reads make no model calls, extraction jobs, live mailbox requests or mutations. Saved emails retain archive state, original IDs and both text/HTML; a partial archive must be checked against Gmail before decisions.

**Coverage is still incomplete.** The goal is parity with every owner app section. These additions cover saved profile/linked records, not every global settings, operational/detail, draft or file screen. Existing dedicated Today, inquiries, work, route/resource and draft tools remain necessary. Live Gmail, files without current saved extraction, original scanned images, convention review acknowledgments and additional global app sections still need adapters and parity verification. Do not advertise complete app access until those are covered and exercised against deployment data.
