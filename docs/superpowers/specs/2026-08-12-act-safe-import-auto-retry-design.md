# Act Safe Import Automatic Retry Design

## Goal

One confirmation must run the safe Act import through all remaining batches without requiring repeated Resume clicks. A temporary mobile or browser connection interruption must not duplicate already committed work.

## Root Cause

The page already loops over `apply-next`, but each 25-record request takes roughly 25–30 seconds. One request was aborted after 24 seconds. The catch handler then ended the loop and exposed Resume, even though the server remained healthy and prior batches were durable.

## Design

- Send at most 10 records per `apply-next` request so normal requests finish comfortably before the observed interruption window.
- Keep the existing server-owned cursor and idempotent approval/request key as the source of truth.
- After a transient fetch/network failure, refresh the run from the server before continuing. This discovers any batch that committed after the browser lost its response.
- Retry transient connection failures up to three consecutive times. Reset the retry counter after any successful batch.
- Do not automatically retry server-declared blocked records, failed operations, stale review conflicts, a disabled live-import lock, or a stalled cursor.
- Keep the page in the Applying state and update durable progress after recovery. Only show Resume if automatic recovery is exhausted or the server reports an actionable stop.

## User Experience

The user confirms the safe import once. The button remains disabled while batches continue. Temporary interruptions may briefly delay progress but do not require another click when recovery succeeds.

## Verification

- A unit test proves a transient fetch failure refreshes server state and continues automatically.
- A unit test proves three consecutive transient failures stop with an error instead of looping forever.
- Existing import and API tests continue to pass.
- The production build and frontend typecheck complete successfully, except for any explicitly identified pre-existing repository failure.
