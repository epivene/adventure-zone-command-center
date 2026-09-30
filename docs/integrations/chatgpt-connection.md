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
4. Complete owner login and the provider-bound consent screen on the API host. Consent is served by the API so interaction cookies remain first-party even when the website is hosted separately. The page reuses `/api/auth/login`, holds the owner bearer only in memory, and never transfers it through a URL. Initially select only **Read profiles, history, saved document text and follow-ups**.
5. Ask for one existing profile by name, then read its history. Confirm the app link, pagination, recorded dates and unknown roles. This must not increase the app's AI usage ledger.
6. Authorize additional scopes only when needed. For a first save, append one owner-approved sourced note to a test profile with a unique request key. Retry that same request key and verify the original operation receipt and one saved record.
7. Revoke access in Settings and confirm further reads, writes and token refresh fail.

If the client cannot supply an exact registered client ID/callback, stop installation and record that compatibility gap; do not enable unauthenticated access or broaden registration. Android/Fold access is a release gate, not presumed available.

## Behavior

- Reads: default 20/max 50 search results; context pages stay below 24,000 serialized characters. Use section names and continuation cursors. Excerpts and omitted sections are explicit. Requested research year is not proof of an event that year.
- Documents: only owner-scoped saved text matching the current accepted blob hash and linked profile is returned. Missing/stale extraction returns `CONNECTION_EXTRACTION_UNAVAILABLE`; no paid extraction starts.
- Leads: an explicit event-specific source URL is stable even if the name/location is corrected, and query-based event IDs remain distinct. If only a general official website is available, normalized event/location are included to keep different events on a municipal website separate. Possible name matches require review. Organizer roles are never invented.
- Notes: source URLs, retrieval timestamps, event years and supplied verification labels are saved. The app does not claim independent verification.
- Updates: general phone, website and address fields only. Organizations have no general email column. Contact/organizer roles, bookings, prices and payment status cannot be overwritten through this interface. Review old/new fields in Settings, approve the exact proposal, and return its approval ID to the requesting conversation. Approval expires after 15 minutes and fails if the profile changes, is merged or deleted.
- Drafts: stored under **Settings → ChatGPT connection → Saved app drafts**, visible even with in-app AI disabled. HTML is sanitized; UI displays plain text. Receipt links open the saved record even outside the first page; use Older drafts/Older proposals to continue browsing. These are not Gmail drafts and cannot be sent by this connection.
- Follow-ups: require explicit UTC/offset due time; owner-facing times use America/Denver. Existing booking reminder replacement behavior applies.
- Recovery: every mutation requires `requestKey`. After a network timeout, retry the identical request key to retrieve the committed result. Never create a new key merely because the response was lost. Receipts are connection-scoped.
- Limits: 256 KB MCP body, 60 requests/minute/connection shared in PostgreSQL, 5-minute access tokens, rotated refresh tokens with a 30-day absolute lifetime.

Shared task leases, dot handoffs, code editing and autonomous scheduling are outside this first release.
