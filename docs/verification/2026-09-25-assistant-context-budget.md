# Assistant context budget repair — verification

## Observed failure and scope

The user screenshot and authenticated live workspace showed a BBQ Days deposit follow-up stopping at 280,437 reported tokens and 9 steps, with no draft displayed. The private production checkpoint/tool trace was not available through the authorized UI, so the exact pending call is unknown. No live message retry, customer write, email send, or setting change was performed for this repair.

## Changes

- Project model input without mutating stored evidence, tool results, or checkpoints. Eliminate source copies already present in tool data and exact repeated receipt-free reads; preserve source identity, event year, version, completion state, timestamps, distinct revisions, full PDF text and visual transcription.
- Expose 18 common drafting/read tools plus discovery; load other schemas only when requested. Discovery validates every name against the current actor-visible registry and persists names through checkpoint recovery. Existing action grants remain enforced by their executors.
- Return paginated approved template metadata and retrieve the selected template's full body separately. Legacy checkpoint calls using empty template arguments still work. Draft preparation still enforces the approved current template version.
- Limit evidence gathering instructions to the request. Deposit follow-ups require relevant commercial records and complete incoming/sent threads; documents resolve terms and calendar checks precede new availability commitments.
- Report usage cutoffs from verified application/Gmail draft receipts, sent-email receipts, and uncertain results. Pending mutations do not execute after cutoff. Unknown outcomes are not reported as failed writes.

## Measured request sizes

Measurements use the production tool registries and JSON character counts, not provider token counts or billing estimates.

| Measurement | Before | After |
| --- | ---: | ---: |
| Default tool definitions | 58,812 characters / 53 tools | 14,162 characters / 18 tools plus discovery |
| Repeated 20 KB profile fixture | 121,494 characters | 20,869 characters |
| Source-body copies in that fixture | 6 | 1 |

Default schema overhead falls 75.92%; the representative source fixture falls 82.82%. Discovering the contract-save tool raises schema size to 23,708 characters; loading all three contract-writing tools raises it to 26,001. Full sources remain in the saved checkpoint.

## Verification results

- Initial regression run reproduced five expected failures; implementation passed all 21 tests in that run. Expanded focused coverage passed 28 tests across 5 files.
- Fresh independent whole-branch review identified one Important cutoff-summary issue and no other blockers. Added Gmail-save, uncertain-write, and sent-email cases: 3 failures before the fix, 15/15 orchestration tests after it.
- Final backend CI selection: 53 files / 251 tests passed in 255.56 seconds on Node 22. This includes assistant runtime/routes, office task repository, inspections, contracts, and invoices.
- Assistant UI regression: 7 files / 20 tests passed.
- API and frontend production builds passed on Node 22; API build reran successfully after the review correction.
- API TypeScript diagnostics match the established baseline: 94 errors with no added file/error-code diagnostics. Repository-wide type checking is not green; these are pre-existing errors.
- UI code is unchanged. Screenshot upload/hydration, scoped reads, grants, receipt preservation, checkpoint restart, and connected business workflows are covered by the selected regressions.

## Review decisions and acceptance

Keep token and step limits unchanged: legitimate large requests may still stop, but redundant inputs no longer consume most of the budget. Advanced tools can require one extra discovery step. Large individual source records remain complete rather than silently truncated.

The review covered changed code and relevant surrounding adapter/authorization paths, not an exhaustive audit of the entire application. The root executor ran the complete established CI selection; the reviewer did not duplicate it. Private production attribution remains unavailable, and measured character reductions do not guarantee a particular model's runtime behavior.

After merge and deployment, retry the same BBQ Days deposit follow-up and confirm a saved draft and accurate status. This remains the live acceptance check; no live completion or provider-token savings are claimed by local tests. Do not send the email merely to validate draft preparation.
