# Connector and Gmail request efficiency

## Command Center connector

Authenticated MCP requests share a database-backed per-connection minute window across server processes. The default allowance is 120 requests/minute (previously 60). Set `CHATGPT_CONNECTION_REQUESTS_PER_MINUTE` to an integer from 30 to 300; invalid settings use 120. Setting 60 restores the previous allowance. This is a bounded throughput increase, not removal of throttling. All requests, including protocol setup, still count.

Responses expose `X-RateLimit-Limit` and `X-RateLimit-Remaining`. A 429 includes `Retry-After` and JSON `retryAfterSeconds`, calculated from the database window rather than an unconditional 60-second wait. Rejected requests do not extend the window. Authentication, scopes and write idempotency are unchanged. No migration is needed.

## App-owned Gmail traffic

Label list reads are coalesced and cached for 30 seconds within a single account-bound client. Callers receive copies; failed reads are not cached. Label create/rename/delete invalidate the cache before and after the request (including uncertain failures). This cache is neither global nor shared across separately created clients or server processes.

Gmail JSON read and label-mutation errors retain Retry-After guidance, including HTTP-date headers. The durable profile-label retry queue waits for the longer of its existing exponential backoff and Google's requested delay, measured from failure time. No new automatic email-send retries are introduced.

## Com's separate Gmail connector

These changes do not configure ChatGPT's built-in Gmail connector or raise Google's quotas. For Com: reuse label discovery during a reconciliation batch; read each necessary thread once; keep saves sequential; honor Retry-After; checkpoint completed message/operation IDs and resume only unfinished work. Batch reads reduce round trips but do not reduce the number of quota-counted underlying requests. Avoid large concurrent batches and do not retry uncertain sends without reconciling their outcome.

Before raising the app setting further, distinguish `CONNECTION_RATE_LIMITED` from Google's 429/403 quota errors and compare request volume and database latency. Today's live logs were not available in this change, so the exact source of Com's reported throttling remains unconfirmed.

References:
- https://developers.google.com/workspace/gmail/api/guides/handle-errors
- https://developers.google.com/workspace/gmail/api/guides/batch
