# Assistant spending controls and Economy mode

The owner requested adjustable spending limits after spending roughly $5 in a day. This change adds an app-managed daily and monthly budgets and lower-cost defaults while preserving deliberate model choices and completed research.

## Behavior

- Default to a $1 daily allowance, $30 monthly allowance, and Economy mode; the owner can save each amount from $0 to $1,000 in cent increments. $0 in either limit pauses new paid generations. Only the authenticated owner settings endpoint can change this; no model tool can raise a limit.
- Display conservative estimated usage, outstanding reservations, remaining allowance, reset time and tracking start. The allowance applies to this assistant's calls after tracking began, not earlier charges or other OpenAI usage. Budget days and calendar months use UTC, with the next resets shown in local time. Both allowances include all unresolved holds; settled monthly usage persists across daily resets. Older clients omitting the monthly field preserve the current monthly limit.
- Reserve before chat, web research and visual document generation. Serialize settings and reservations in a database transaction, prevent duplicate call IDs, retain unresolved holds across restarts and midnight, and reconcile only known completed usage. A setting change never removes a hold or restarts work automatically.
- Count the actual model input before normal generation. Reserve maximum output and conservative published input/cache-write rates. Hosted web searches reserve additional context and search fees. Unknown pricing or failed preflight pauses generation. These estimates deliberately may pause before the displayed balance reaches zero; they are not an OpenAI invoice guarantee.
- Economy selects the cheapest configured supported model for new chats and research/document assistance. Explicit chat model choices remain available. Reduce routine chat output ceilings while preserving document transcription space.
- Reuse complete cited public research within the same owner, conversation, selection, year, query and model for 24 hours. Preserve original retrieval times and drop prior usage from cached reads. Include a compact saved research index on later runs; allow an explicit fresh research request. Reuse does not certify profile completeness or current truth.

## Implementation and verification

1. Add a durable settings/reservation ledger, startup/schema/readiness wiring and transaction tests.
2. Add provider preflight/settlement and integrate all three paid paths, with friendly partial outcomes and no-charge retry handling.
3. Add owner settings routes and a compact, touch-friendly spending editor. Polling must not overwrite unsaved edits; conflicting edits must be reviewed again.
4. Add scoped research reuse and a read tool, with tests for ownership, expiry, partial results, retrieval times and zero duplicate usage.
5. Verify concurrency boundaries, unknown charges, $0, lower limits, UTC rollover, model routing, settings authorization and frontend state. Use mocked providers only; no paid smoke tests.
6. Review changes independently, run focused suites/builds and compare existing TypeScript diagnostic baselines. Publish a draft PR stacked on the conversation-controls change if it remains unmerged.

Physical Galaxy Fold validation and real multi-connection PostgreSQL contention require their respective environments; report those limits accurately.
