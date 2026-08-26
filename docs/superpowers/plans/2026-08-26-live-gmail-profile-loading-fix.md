# Live Gmail Profile Loading Fix

## Problem

The profile Gmail list endpoint fetched metadata for every historical mapped Gmail message ID with one `Promise.all()`. One stale/unavailable message caused the entire profile Gmail panel to return HTTP 500 with `GOOGLE_WORKSPACE_API_REQUEST_FAILED`, even when other mapped Gmail conversations were healthy.

## Intended behavior

Gmail remains live and authoritative. Historical backflow provides durable profile/thread relationships. Profile views should load the current Gmail thread for each mapped thread and should not convert Gmail into a local message archive.

## Fix

- Group profile mappings by Gmail `threadId`.
- Fetch each unique thread live with `getThreadDetail`.
- Derive list metadata from the latest message in the live thread.
- Do not require a Google API call when a profile has no Gmail mappings.
- Isolate an unavailable/stale thread when at least one other live thread succeeds.
- If all mapped threads fail, surface the real Google error.
- Map reauthorization/authentication failures to HTTP 409 and transient Google API/token failures to HTTP 503 instead of generic 500.
- Mark the frontend contract as `liveGmail: true` with `unavailableThreadCount`.

## Scope

This does not add Gmail send/reply yet and does not modify the historical Gmail backfill cursor, mapping decisions, OAuth scopes, or Gmail content.