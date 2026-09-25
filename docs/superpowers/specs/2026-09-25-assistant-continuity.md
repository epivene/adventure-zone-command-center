# Assistant conversation continuity and document reuse

Continue the approved unified assistant upgrade after PR #948. Deliver two independently testable improvements within the existing owner workspace.

## Conversation context

Keep original messages intact. For each owned run, retain six recent full messages and at most 24 older, source-linked excerpts of 1,200 characters. Count omitted messages explicitly. Excerpts are a bounded overview, not a semantic guarantee that every old correction survived. Include message ID, sequence, role, timestamp, requested scope and resulting scope; unknown scope remains unknown. Never turn old assistant claims into receipts, rules, grants or approved actions.

Freeze the context in the lease-fenced run checkpoint before the first provider call. Recovery must reuse it. A history tool searches or pages original messages within that owned conversation, bounded by the run's source user message, with at most three full messages per result. Current rules continue to load independently. Active provider reasoning and function-call items are not compacted. Surface summary coverage and original-message links in the workspace.

## Document extraction

Reload source permissions, current metadata and current bytes before every cache lookup. Cache by owner, source identity, connection, byte hash and extraction revision. Never cache customer attribution as authority. Validate selected customer membership through direct and booking relationships; validate Gmail attachment membership and selected customer association. Preserve partial-page gaps, visual-review requirements and unverified execution/payment/signature status.

Durably claim extraction before any visual provider call. Completed readings may be reused without charging their historical usage to a new run. Interrupted or concurrent attempts must not automatically repeat a potentially billed call, including after a model/run change. A changed file creates a new identity. This phase does not add a force-refresh switch: unresolved attempts require review, avoiding a model-controlled retry loop.

Use the configured model from the owned saved run, disable retries and enforce a timeout through the complete response body. Preserve known usage on incomplete responses and unknown usage on transport failures. Stop multi-document comparison after unknown usage. Show extraction time separately from current retrieval time and identify reused readings.

## Global constraints

- Node 22; existing Express/React/PostgreSQL stack and dependencies.
- Feature remains disabled by default; no deployment or production activation.
- No customer messages or live provider calls during validation.
- Existing review, permission, revision, receipt and lease boundaries remain authoritative.
- Production activation still requires live browser/provider acceptance and owner configuration.
