# Assistant spending controls verification

## User-visible behavior

Assistant Workspace has a compact Spending controls panel with editable daily and monthly USD allowances, Economy toggle, conservative used/held/available amounts, reset time, and tracking start. Defaults are $1/day, $30/month and Economy enabled; $0 in either limit pauses new paid work. The owner may save each limit from $0–$1,000 in cent increments. Budget edits use version checks and never resume work automatically. Offline controls are read-only. Background usage refreshes preserve unsaved edits.

The allowance covers this assistant after tracking starts. Earlier charges and other apps are excluded. It is a conservative app estimate, not an exact OpenAI invoice cap. UTC days reset daily settled usage; UTC calendar months reset monthly settled usage. Unresolved holds survive both boundaries. Available funds use the smaller remaining allowance. Work already started can still be charged after lowering a limit. Unknown holds are not automatically forgiven; provider reconciliation remains an operational task.

New chats prefer the cheapest configured supported model. Historical and explicit chat choices remain intact. Economy uses the configured cheaper model for research and visual reading, reduces routine chat output to 2,048 tokens and public research to one hosted search with up to 2,000 output tokens. Document transcription retains its existing output allowance.

## Enforcement

- All production chat, public research and visual document generations share the durable spending store. Settings and reservations serialize on the owner's settings row in a pinned Drizzle transaction.
- Count the exact Responses input before generation, including images, PDFs and tool schemas. Unknown prices, unsupported endpoints/tiers, count failures and insufficient allowance stop generation.
- Reserve conservative published input/cache-write rates and maximum output. Hosted search reserves counted initial input, output/context headroom, the documented 128k search context per possible round, tool fees, and an additional conservative search-content allowance. The latter may count content twice when provider input telemetry already includes it.
- Complete supported responses settle measured tokens conservatively. Missing/incomplete/uncertain responses retain their full reservation. Unique call identities prevent an interrupted request being issued twice. Confirmed overruns are recorded without clipping.
- A no-charge preflight failure leaves a document retryable; an unknown paid extraction remains protected against rebilling. A paused request check is explicitly reconciliation-only and cannot queue paid work even if the allowance changes elsewhere.
- Only authenticated owner HTTP settings can raise limits. Model tools cannot modify spending settings or ledger records.

## Saved research

Complete cited reports can be reused for 24 hours within the same owner, conversation, selection, event year, normalized query and requested model. Reuse keeps original source times, never extends expiry and carries no duplicated usage. Partial/uncertain/uncited results are excluded. Explicit refresh remains available. A historical index plus list/read tools lets later runs discover completed research after selection changes. The UI labels reuse and stale reports; a completed report does not certify a completed profile or a current fact.

## Prior daily-control validation

Provider requests were mocked; no production data, messages, billing settings or paid model calls were changed.

| Check | Result |
| --- | --- |
| Broad API regression run | 183 tests in 18 suites passed |
| Final request recovery API regression | 27 tests in 3 suites passed |
| Broad frontend regression run | 60 tests in 9 suites passed |
| Final spending/model/recovery frontend regression | 25 tests in 3 suites passed |
| API and frontend production builds | Passed |
| TypeScript diagnostics versus baseline | Existing 94 API / 135 frontend; no added file/code counts |
| Migration consistency | Startup and dated spending SQL match |
| Independent financial and UI review | Findings addressed: cheap-model research pricing, endpoint pricing, safe document preflight, new-chat Economy selection, saved research discovery, and read-only request reconciliation |

The targeted runs overlap the broader runs. PGlite exercises transactions and interleavings, not real multi-connection PostgreSQL contention. Physical Galaxy Fold rendering remains unverified. Live provider token-count endpoint availability/model access was not smoke-tested, to avoid using production credentials or incurring a paid request. An unavailable count endpoint fails closed with a visible pause.

## Pricing references

Verified 2026-09-26 against official documentation:

- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/token-counting
- https://developers.openai.com/api/docs/guides/tools-web-search
- https://developers.openai.com/api/docs/models/gpt-5.4-mini
- https://developers.openai.com/api/docs/models/gpt-5.4-nano

The pricing version is retained in code and charged ledger amounts are not recomputed when prices change. Published-rate assumptions must be reviewed when adding models or changing providers.

## Daily and monthly continuation — 2026-09-26

Monthly-limit regression tests were observed failing before implementation. The extension covers enforcement across day rollover, simultaneous reservations against remaining monthly allowance, month rollover with uncertain holds, zero monthly pause, invalid amounts, settings version conflicts, migration replay, owner HTTP validation and UI save behavior. Old PATCH requests that omit the monthly field preserve the existing limit.

Fresh validation: spending/provider/cache/route checks passed (46 tests, 4 suites); assistant UI checks passed (48 tests, 6 suites); API and frontend production builds passed. A fresh independent source review found no Critical or Important issues. Broader assistant integration checks passed (98 tests, 10 suites), bringing the fresh selected API total to 144 tests across 14 suites. Typechecking reported 135 frontend and 94 API diagnostics, matching the recorded prior counts. An initial three additional errors caused by a missing copied declaration artifact disappeared after restoring that unchanged artifact. No spending-related diagnostics were reported. No live provider calls or production data changes were made.

All changed baseline blobs were verified against PR #958 head `624d1056456fb3c519c24977e5da50acf6d507fe` before publication. This change is stacked on that PR and does not deploy itself. Physical Fold rendering, live token-count endpoint access and actual multi-connection PostgreSQL contention remain unobserved.
