# SDD ledger - plan: docs/superpowers/plans/2026-10-06-unified-booking-workspace.md
Base: d376f2152700bab3c59d118ae7e4da394fbd1fea
Branch: codex/unified-booking-workspace-2026-10-06
Ruling: Connector-backed isolated branch and local file mirror replace git worktree scripts because this project is not a git checkout and shell network is restricted. Cost: commits and task boundaries must be tracked through connector SHAs.
Pre-flight: Task 2 state parser consumed by Task 3; names agree. Task 3 thread context consumed by Task 5 profile links; preserve URL IDs.
Ruling: Use dependency-free Node behavioral harness when full Vitest dependencies are unavailable; retain compatible Vitest tests where possible. Cost: browser rendering/typecheck may remain unverified locally and must be reported.
Task 1: implemented (3 Node behavioral tests RED to GREEN; connector discovery reviewed in source; Vitest suite unavailable). Commit fe61ed8849a9575a90a5ac234f3b8b4d53eafcdf.
Task 2: implemented; routing/navigation models RED to GREEN. Commit 85ba88b1a02e820b69853e82a6a00e214ee4a4f1.
Task 3: implemented; account-scoped restoration and attention paging RED to GREEN; syntax checked; UI suites not yet available. Commit 685c3dcb4dad6bfe0d8b92cedf70e4fec8b2173f.
Ruling: Attention list lives in a focused read helper used by the existing service rather than enlarging the repository; preserves authorization and active account check. Cost: another module to maintain.
Task 4: implemented; dedup/group ordering/waiting behavior RED to GREEN; legacy workflow controls retained collapsed. Commit e029a66ac6c65dbe0597d08bc0c3b608462670fc.
Ruling: Group previews retain detailed legacy controls in collapsed tools rather than rewrite call workflows. Cost: optional tools still contain older layout sections.
Task 5: implemented; merged history IDs tested; original note-management timeline retained collapsed. Commit c459dac0a247d2c867cd0f0d706afdabb22b8dcf.
Ruling: ProfileActivityHistory consumes existing loaded activity/email data rather than refetching by profileId; retains boss read-only and original note editing controls. Cost: parent owns data loading.
Task 6: implementation and one final-review fix pass complete. 16 behavioral/catalog tests and 2 React SSR tests pass. Existing native mailbox regression harness: 28/28 pass. TS6 transpile syntax diagnostics: 26 files, 0 errors. Full pnpm test/typecheck/build commands report No projects found; these checks did not run. Live browser/Fold viewport validation remains unverified.
Ruling: Restore cached TypeScript and React into scratch-only validation tools without adding product dependencies. Cost: syntax/SSR checks are narrower than complete frontend integration and typecheck.

Final fresh review: four Important findings repaired in one fix pass:
- Fetch thread/draft deep links by stable identity even when absent from first mailbox page.
- Retain selection separately from phone list/reader visibility; persist review selection per account; defer scroll restoration until list content loads.
- Remount filing previews for account/message/profile changes.
- Deduplicate Today mail actions by source type and source ID, preserving distinct actions in the same thread.
Ruling: Regrade the review's two Minor findings as Important because direct review Compose lacked a usable account and saved attention changes left active task views stale. Both repaired in the same fix pass. Cost if wrong: a slightly broader functional fix pass than the original severity labels required.
Ruling: Review hydration uses state and account-keyed lifecycle to avoid overwriting saved context during first-render effects. Cost: review panel remounts when the connected account becomes known.
Ruling: Keep COM filing/link parity outside this redesign, as the approved plan deferred it; inquiry tools are read-only. Cost: existing COM filing still archives until that separate change.
Ruling: Keep route planner flags unchanged, as the approved plan defers activation. Cost: disabled planners remain unavailable.
Ruling: Deployment, COM tool refresh and live viewport verification follow merge/deployment; create a draft product PR because full build/typecheck could not run here. Cost: UI/type errors may still require follow-up before merging.
Ruling: Retain the connector-backed local mirror for PR feedback rather than delete the work directory. Cost: local scratch storage remains allocated.
