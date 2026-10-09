# Shared booking date repair follow-up

A selected booking may save independently proved dates while another booking lacks dates. Unknown windows remain readiness/capacity review warnings. They do not establish a package overlap and cannot consume a proved overlap slot in the date repair check. Actual overlapping package commitments and existing hold/resource/crew/plan/trip and signed-window reconciliation guards remain blocking.

The saved source matcher now isolates sentences as well as semicolon/bullet clauses. HAFFE's application deadline sentence no longer disqualifies its separate convention date sentence. SnowWiesn's historical 2022 sentence no longer makes its local 2026 event range ambiguous. Explicit US M/D/YYYY and day-first full-month dates normalize through the existing validated calendar range matcher. No booking year, note creation date or requested endpoint is used to supply a missing year. Ambiguous years within the same clause, invalid calendar components and public/access mismatches remain rejected.

The UI explains unknown-commitment warnings, preserves rejected-source drafts, and shows missing public or reservation evidence before and after repairs. A missing reservation is an outstanding evidence question when equipment/crew reservations are needed, not permission to infer access dates from the public event. These changes neither confirm commercial bookings nor reserve resources.

## Verification

- Reproduced HAFFE and SnowWiesn failures against the baseline shared matcher.
- Executed 17 matcher test cases with a lightweight JavaScript harness after removing TypeScript-only syntax. Existing conservative cases remain green.
- Executed the actual impacts method body with narrow pure resolver/clock/hash stubs: at capacity two, a target plus one proved overlap plus one unknown window blocks before the patch and saves with a review warning afterward; at capacity one the proved conflict remains blocked.
- Added PGlite preview/apply regressions for both saved-source patterns and both capacity scenarios, plus UI regressions for the warning and rejected-source guidance.
- Full Vitest, PGlite, UI and typecheck verification could not run: the local command runner fails process creation with exec-server helper_unknown_error. The JavaScript harness does not substitute for those checks. No live booking dates changed and no deployment verified.

Run without paid GitHub Actions in a working local checkout:

```sh
pnpm --filter @workspace/api-server test src/features/booking-date-repair
pnpm --filter @workspace/adventure-zone test src/features/event-date-coverage/BookingDateRepairs.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Missing or genuinely ambiguous saved evidence still requires collecting/reviewing that evidence. Imported sales dates and historical ACT snapshots are not automatically promoted to verified event or reservation dates.
