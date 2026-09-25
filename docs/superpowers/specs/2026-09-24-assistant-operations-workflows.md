# Assistant operations and office workflows

Continues the already approved Stage 4 roadmap, alongside the campaign stage on a new isolated feature branch after PR #947.

## Outcome
The owner can ask about legs, bookings, resources and inspection progress, and prepare exact reviewed tasks for an enabled office coordinator. Staff see those tasks in the existing office workspace. The owner assistant remains owner-only.

## Design
- Route reads use the canonical travel-leg repository and preserve assigned versus suggested legs, confirmed versus potential records, missing dates/location and explicit event-year classification. Unknown-year items remain separate.
- Booking operations reads require selected customer/booking/year and a fresh canonical operations-summary provider. Resource overlap, unavailable equipment, missing transfer estimates and acknowledged overrides remain visible. A suggested route or overridden warning is never an availability promise.
- Resource inventory and inspection reads use existing repositories. Explicit inspection year remains separate from event year. Historical piece snapshots, current lifecycle and maintenance states remain distinct. Do not infer repair completion, safe operation or photo review; exclude private storage keys and signed file URLs.
- Staff reads expose only allowlisted account identity and task DTOs. The owner can prepare create/update office-task actions with exact account, profile/contact relation, title, instructions and optional due date. Existing task types/statuses remain authoritative.
- Task writes use existing DrizzleOfficeTaskRepository inside a transaction with account/target locks, exact revision validation, audit and assistant receipt. Replays reuse the receipt. Unspecified manual due dates and coordinator notes remain unchanged. No messages, email, resource allocation, manager overrides or inspection completions are executed by these tools.
- UI displays reviewed handoff details and links to the existing owner office workspace. Generic Dave event handoff continues to use one existing calendar event containing every package; do not misclassify it as a convention request.

## Verification
Node 22 and current owner password/HMAC authentication. Test wrong customer/year, no credential/storage-key leakage, historical inspection distinction, resource warnings, inactive accounts, moved contacts, stale revisions, duplicate approval and atomic rollback. Use existing route/resource/inspection/office regressions. Feature stays disabled until previously documented deployment gates pass.
