# Assistant document workflows implementation

Spec: docs/superpowers/specs/2026-09-24-assistant-document-workflows.md
Base: 7c75749. Existing isolated branch feat/unified-assistant, draft PR #947.

1. Commercial evidence: scoped contract/invoice/payment reading with explicit event-year classification, existing invoice arithmetic and provenance. Test historical, unknown-year, cancelled/draft, and voided-payment exclusions before implementation.
2. Comparison: compose existing document reader, preserve all page/evidence completeness, report cross-customer/year reference boundaries, reject inaccessible or stale sources, and expose a tool plus source cards. Test unreadable/sample/signature distinctions.
3. Document actions: reuse existing active templates and contract builder; strict typed parameters; frozen customer/year; exact revisions; explicit grants; transaction-backed replay receipts for database actions. Expose create proposal/invoice project, start/save contract draft, and reviewed payment recording.
4. Signed-file and PDF actions: reuse contract services with explicit target/revision/file confirmation and no sending. Expose review links when existing service preconditions block.
5. User experience: source/comparison cards and readable document/financial action previews. Original source opens through authenticated app actions, not arbitrary URLs. Persist results across refresh.
6. Integration: targeted backend/UI tests, builds and typecheck comparison, supplied-PDF reader smoke test without committing private files, independent final review. Update draft PR and rollout guide; do not merge/deploy/enable or send customer mail.

Rulings: implementation reuses existing approved templates and editors; no new universal contract or financial terms. Live provider validation requires a designated authorized test mailbox/calendar, so local acceptance evidence must name its limits.
