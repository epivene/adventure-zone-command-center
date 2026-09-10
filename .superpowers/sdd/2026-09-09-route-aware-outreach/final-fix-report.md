# Final whole-feature fix report — 2026-09-10

Base: `5418c9544903e17e4836b68dce25f2414b378c2d` in `/workspace/scratch/bd8890c17c95/task4c`, branch `codex/outreach-identity-resolution`.

This is the single authorized final fix wave. Source, tests and this report were checked against I1–I7 and M1–M3 before committing. No subagents, remote operations, live/provider data, outgoing communications, rollout changes or other-worktree mutations were used.

## Finding-to-change map

| Finding | Implemented contract | Focused evidence |
| --- | --- | --- |
| I1: real day-21 Advance | Portfolio recognizes `advance`; the UI matches the actual server release contract rather than requiring `first_choice`. Released/leading-pursuit, live-hold, source-review and manual-promise gates remain. Releasing advisory pursuit does not need or promise physical availability. | Real `evaluateOutreach` plus `applyPortfolioPriority` DTO tests, including missing allocation facts passed to the UI, and existing hold-protected Advance interaction. |
| I2: waiting contacted pursuit | Established pursuits sort ahead of untouched work and remain in the virtual contention set between actual attempts. Waiting remains a waiting task; callbacks and competing conversations retain named conflicts. Explicit release removes advisory contention, never a physical reservation. | Initial-contact and delayed-follow-up waiting intervals across two openings sharing one package, then deliberate release; original shared-resource and adjacent-travel callback cases pass. |
| I3: owner-resolvable urgency | `cadenceOverride.timelineReviewed` is a strict optional boolean persisted with the audited cadence. Short operational timelines initially require review; an explicitly acknowledged valid cadence is effective. Defaults, delayed-attempt minimum gaps, source blockers and reply/decision precedence remain. | Before review, unaudited shorter cadence, acknowledged cadence, delayed actual attempt, default gap, missing evidence, reply precedence and UI submission cases. |
| I4: released late replies | Repository projects new inbound observations on released pursuits into Needs review; portfolio and Today retain that attention without adding capacity or pursuit priority. Inbound classification remains available. `resumeReleased:true` on the existing owner-only candidate patch requires classified late evidence, a decision date, clear source/contact/closed-status protections and fresh allocation. Shared allocation/leadership locks protect the recheck; a failure rolls back release-state changes. Competing established pursuits require explicit resolution. Audit detail records the resume decision; existing contact attempts/history remain. Profile summary links late-reply review to Today. | Actual sent chain → real Advance → `observeInboundOutreach` → released attention → classification → competing callback rejected and retained → owner explicitly resolves callback → Calendar failure rolls back → successful fresh resume with all attempts preserved and no hold. UI renders, classifies and submits the explicit resume decision. |
| I5: current dispatch protections | Shared dispatch protection combines exact communication blocks with current organization `last_resort`, opportunity email protection, current event-year decline/not-pursuing and territory rules. It runs at review, approval, claim and final `beforeSend`. Exact override recipient remains checked. Existing explicit territory exception remains respected; ordinary administrative/content approval is not a waiver. Unknown Office outreach classification retains territory review. | Both draft kinds exercise each protection after approval and after claim, including regional territory rules. Actual scheduled Opportunity dispatcher/service and Office coordinator use the real guard; protection changes after claim prevent mocked final provider submission and record definite `not_sent`. |
| I6: base allocation repair | Base SQL independently repairs columns, NOT NULL, primary/foreign keys, quantity/resource/revision/owner constraints and hold lifecycle/window/state checks, plus indexes/functions. Foreign keys are recognized by their child column and referenced table/column, independent of generated constraint names. Readiness covers required NOT NULL/constraints/functions. The migration runner rechecks each marker after SQL and throws if still incomplete. | Retained demand and live hold survive Drizzle-named foreign keys, a dropped revision, missing hold lifecycle/quantity constraints and missing NOT NULL, then two actual SQL repairs. Markers recover with exactly five foreign keys; invalid lifecycle, empty/null quantity writes fail. Runner test proves incomplete repair stops deployment; existing serialized skip/repair test includes the postcheck. |
| I7: identifiable uncertainty | Selector names profile/year, recipient, subject and unique dispatch ID. Selected panel shows exact final recipient/subject/body, profile/opportunity/booking/draft references, Gmail draft/thread, provider error, confirmation and review-after time. Outcome starts blank; operation termination is separately acknowledged. Changing delivery resets outcome and all evidence. | Two unresolved Office sends: only the selected payload is visible, action stays disabled without deliberate outcome/termination, exact dispatch ID is reconciled, selection change clears acknowledgement/evidence. |
| M1 | Frontend uses server discriminant `conflict`, including red conflict styling. | Real conflict DTO interaction. |
| M2 | Planner Needs review precedes Contact next, waiting, openings and research; existing Today sections are untouched. | DOM ordering assertion and unchanged existing planner interactions. |
| M3 | Dedicated events need a renewal review/decision date; UI labels and saves that date explicitly. Prior participation creates no permanent reservation. | Dedicated missing/future/due renewal policy and UI affordance cases. |

## Exact verification commands and results

All commands below completed against the fixed tree. `DATABASE_URL` is deliberately unreachable; database cases inject isolated PGlite and provider/network boundaries use local fakes.

From repository root:

```sh
DATABASE_URL=postgres://invalid:invalid@127.0.0.1:1/unreachable node_modules/.bin/vitest run --maxWorkers=1 --testTimeout=20000 artifacts/api-server/src/features/outreach-planner/outreach-policy.test.ts artifacts/api-server/src/features/outreach-planner/outreach-portfolio.test.ts
```

Exit 0: **46 passed across two files**, 1.04s.

From `artifacts/api-server`:

```sh
DATABASE_URL=postgres://invalid:invalid@127.0.0.1:1/unreachable node_modules/.bin/vitest run --maxWorkers=1 --testTimeout=20000 src/features/outreach-planner/outreach-allocation.pglite.test.ts src/db/act-review-migrations.test.ts -t 'final review|serializes schema repair'
```

Exit 0: **eight passed across two files**, 54 intentionally unselected cases, 15.02s. This includes all six new PGlite lifecycle/dispatch/migration cases and two runner cases.

From `artifacts/adventure-zone`:

```sh
node_modules/.bin/vitest run --config vitest.config.ts --maxWorkers=1 src/components/today/outreach-planner.test.tsx
```

Exit 0: **28 passed**, 5.74s (including four new contract interactions).

From each application directory:

```sh
../../node_modules/.bin/tsc -p tsconfig.final-review.json --noEmit --pretty false
```

Both exit 0, no diagnostics. Temporary local configs disable incremental output, map workspace package exports to this checkout, and scope roots to the changed planner/API files (API includes the changed policy/portfolio/PGlite/runner tests and uses the production Zod v4 alias). Frontend roots are the planner component and API DTO/client. Configs are uncommitted verification aids. These results do not claim a clean unrelated full-workspace TypeScript graph.

From `artifacts/api-server`:

```sh
node ./build.mjs
```

Exit 0: 16.5 MB API main bundle, esbuild 2.187s.

From `artifacts/adventure-zone`:

```sh
node_modules/.bin/vite build --config vite.config.ts
```

Exit 0: 2,542 modules, 21.63s; planner chunk 82.95 kB, 19.29 kB gzip.

```sh
git diff --check
```

Exit 0. Only named source/test/docs/report paths are staged for the final commit. Latest-main questionnaire, existing Today priority sections, hold requirements and default-off flag implementation are unchanged.

## Corrections made during this wave

Initial focused verification found missing reciprocal competitor labels after established callbacks moved ahead in sorting; the portfolio now preserves those visible relationships. Test setup corrections supplied required inbound metadata (the final lifecycle now uses the actual inbound observer), normalized returned ISO instants, opened the enclosing UI review section, and returned a Promise from the Office repository fake. The frontend scoped compiler caught missing Gmail payload reference fields; the DTO now exposes them.

Three PGlite cases hit Vitest's default five-second case limit while builds and compilers shared CPU. The final exact database gate ran without concurrent builds and with an explicit 20-second case limit; all eight selected cases passed. No unrelated broad suite was rerun or used to inflate this wave's evidence.

The scoped re-review cleared I1–I5, I7 and M1–M3, then reproduced one I6 constraint-name defect: SQL-created `_fkey` checks did not recognize the equivalent names emitted by the repository's Drizzle schema. The bounded correction now detects each foreign key by its actual child and parent columns, and the retained-data regression renames all five keys to the Drizzle names before two repairs. The focused eight-test migration gate, scoped API compiler and API production build pass after this correction; the repaired schema remains ready with exactly five foreign keys.

## Limitations and rollout

- Rollout remains default-off. No live Calendar, provider delivery, production migration or real configuration was verified. Existing browser-preview restrictions remain as documented in the verification report.
- Missing retained factual/source identity fields cannot be reconstructed safely by SQL; additive repair fails instead of fabricating them. Valid metadata defaults can be restored. Deployment now fails if readiness is still false.
- Late-reply resume deliberately blocks potentially competing established pursuits with missing target facts; owners must resolve that evidence/pursuit first. It does not create a hold, and specific promises still require a real current hold.
- An unassigned Office draft may require event identity review where profile opportunities contain applicable restrictions. No new blanket administrative protection exception was created.
- The 82 unique passing tests, two scoped compiler checks and two production builds are bounded evidence for this fix wave, not production rollout certification or a new independent whole-feature review.
