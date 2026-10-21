# Profile duplicate scan responsiveness

The owner scan at GET /api/profile-duplicates previously ran the exhaustive matcher synchronously on the API event loop. A deterministic 3,000-profile synthetic sample (4,498,500 comparisons, zero suggestions) took 52,531 ms locally; a scheduled heartbeat could not run until the scan ended. This can starve health checks and contribute to proxy/network failures. The supplied production startup logs do not identify the precise cause of the reported browser Failed to fetch.

The API now uses a cooperative matcher: names, aliases, normalized locations, event years/kinds and bigram counts are prepared once per profile. Pair scoring reuses that data, and comparison work yields to the event loop in approximately eight-millisecond slices. Every pair is still checked; confidence thresholds, dismissals, ranking and merge/undo behavior are preserved.

On the identical synthetic sample, the revised scan took 5,229 ms and served heartbeats during the scan (largest observed heartbeat gap: 35 ms). These are local reproduction measurements, not production timing guarantees. Exhaustive matching remains quadratic; preparing/sorting results and serializing very large result sets are still synchronous.

Scan and merge history are independent UI reads. History failure retains successful scan results, reports its own error, and does not imply that no duplicates exist. Scan failure is identified separately and directs the owner to Scan again. The scan route logs start, completion, number scanned, suggestion count and elapsed milliseconds without logging profile content.

## Verification

- A regression first failed because the baseline scan prevented a queued event-loop task from running.
- Two UI regressions first failed because a history rejection discarded scan results and the scan's raw fetch error appeared alongside a misleading empty-result message.
- After the change, all 15 tests in the focused local checkout passed: the existing 11 real PGlite matcher/merge/undo tests, two matcher tests, and two new UI tests.
- Compared 4,950 pair scores/reasons against the unchanged baseline implementation and compared the complete ordered result list; identical.
- Targeted TypeScript check passed for matching.ts, service.ts and their contracts dependency.
- Full monorepo build/typecheck and production browser retest remain unverified. The partial local checkout does not contain the complete project dependency tree; the older UI test file's user-event dependency is absent locally. No paid Actions run was requested and no production profiles were changed.

After deploying, retry Profiles → Find duplicates. API logs should show Profile duplicate scan started and Profile duplicate scan completed. If the browser still fails before a start log, investigate the frontend API origin, CORS/preflight, connectivity and gateway request logs rather than database startup output.
