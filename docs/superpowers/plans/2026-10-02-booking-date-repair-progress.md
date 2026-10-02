# SDD ledger — plan: docs/superpowers/plans/2026-10-02-booking-date-provenance-repair.md

Execution: Native; approved October 1, 2026 America/Denver. Draft PR #993.
Ruling: Use isolated feature-branch mirror and GitHub Git Data commits instead of a linked worktree — direct GitHub and npm network access are denied in the shell, while the repository connector works — cost if wrong: local mirror drift; compare every remote parent before committing.
Ruling: Run Vitest/PostgreSQL/build verification in GitHub Actions rather than install locally — npm registry access returns EACCES and no project dependencies are cached — cost if wrong: slower verification; do not claim success before reading CI results.
Pre-flight: Task 1 produces evidence/resolver/SQL consumed by Tasks 2–5; naming and field types consistent.
Pre-flight: Task 4 produces preview/apply DTOs consumed by Task 5; authenticated actor always comes from server, not proposal.
Task 1: started; BASE c760a5645adb58fb55043057a882bf9598ec2d10.
Task 1: initial RED run 36963795234: missing date-evidence module. Added API scaffold to observe behavioral assertion failures before implementing policy.
Ruling: Shell now rejects even Get-Location with sandbox provisioning failed (-32603); continue repository connector and CI execution — cost if wrong: no local test turnaround; all claims require remote results.
Task 1: RED observed in CI run 36963926794, job 110703416477: 11 behavioral assertions fail against raw-window scaffold, plus 2 missing migration failures. Implementing evidence policy now.
Ruling: Add publicEndExclusive/reservationEndExclusive to resolver response — overlap readers must distinguish exclusive boundaries without altering raw evidence — cost if wrong: additional additive response fields.
Task 1: core resolver/migration GREEN step succeeded in run 36964086497; shared-library typecheck also passed. Full compatibility suite remains in progress; inspect its retained logs before final completion claim.
Task 2: started; add normalizer and real SQL replay regressions before changing importer.
Task 1: complete (commits c760a564..dc49adfe; CI 36964086497: resolver/migration 13/13, compatibility 306/306, shared-library typecheck and API/frontend builds passed; job logs read).
Task 2: RED normalizer assertions observed in run 36964244474. SQL replay test timed out during PGlite setup; extend test limit to 30 seconds and rerun before importer changes.
Ruling: PGlite tests use 30-second timeout — concurrent WASM startup exceeded Vitest default 5 seconds — cost if wrong: slower detection of genuinely stalled tests.
Ruling: Also block date writes from previously persisted ACT operation payloads — fixing only new normalization would leave old close-date manifests able to write public dates — cost if wrong: pending date operations require owner evidence repair rather than importer approval.
