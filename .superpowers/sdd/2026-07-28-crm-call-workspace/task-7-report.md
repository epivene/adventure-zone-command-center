# Task 7 — Today integration and workflow verification

## Result

Today now reads every open follow-up, including organization-only and contact-only records. Call follow-ups preserve their exact Call Workspace context; non-call booking follow-ups remain on the booking, while non-call contact/organization work stays on its respective record.

## RED evidence

Added `keeps a non-call booking follow-up on its booking record` to `tests/unit/today-components.test.tsx` before changing production code.

```text
npx vitest run tests/unit/today-components.test.tsx tests/unit/today-priority.test.ts
FAIL: expected href="/bookings/booking-1"
received href="/calls/new?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call"
```

The focused GREEN rerun passed with 19 assertions across the Today and context suites.

## Files

- `features/follow-ups/today-query.ts`: query open follow-ups directly, join optional booking/contact/organization context, and keep booking planning counts separate.
- `components/today/next-call-card.tsx`, `components/today/follow-up-list.tsx`: route calls to Call Workspace and non-call work to its correct owning record.
- `tests/unit/today-components.test.tsx`, `tests/unit/today-priority.test.ts`, `tests/unit/call-workspace-context.test.ts`: cover routing and nullable scope context.
- `tests/e2e/call-workspace.spec.ts`: covers exact Today context, Interested replacement/timeline, Declined closure, Last Resort reason, and Quick Add completion.
- `tests/e2e/responsive.spec.ts`, `tests/e2e/accessibility.spec.ts`, `tests/e2e/fixtures/release-bookings.ts`: add Call Workspace viewport, focus, labels, and scoped fixture coverage.

## Verification

| Command | Outcome |
| --- | --- |
| `npx vitest run tests/unit/today-components.test.tsx tests/unit/today-priority.test.ts tests/unit/call-workspace-context.test.ts` | PASS — 19 tests |
| `npm test` | PASS — 365 passed, 11 skipped |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm run test:e2e -- tests/e2e/call-workspace.spec.ts tests/e2e/responsive.spec.ts tests/e2e/accessibility.spec.ts` | BLOCKED — application startup repeatedly reports `@clerk/nextjs: Missing publishableKey`; no configured authenticated test environment was available. |

The E2E command was also retried directly with `npx playwright test` and hit the same missing Clerk publishable-key startup gate. Assertions remain enabled; no tests were weakened or skipped to conceal that gate.

## Accessibility and responsive review

The Call Workspace retains its responsive `minmax(0, ...)` grid and its phone/desktop overflow checks now exercise the workspace itself. Keyboard coverage focuses and activates the start control, verifies the visible orange focus outline, and verifies the associated labels for call note, disposition, next action, and date before focusing the save control. Existing form labels are explicit `label`/`htmlFor` associations.

## Authorization and integrations

No new server actions, reads, mutations, analytics, notifications, or external writes were introduced. Existing Today page and Call Workspace action paths remain owner-gated.

## Commit

`feat: connect calls to Today dashboard`

## Concerns

Browser execution requires a configured Clerk publishable key, authenticated Playwright storage state, and fixture database URL. The static/unit/build verification is complete; the E2E assertions require that environment to execute.
