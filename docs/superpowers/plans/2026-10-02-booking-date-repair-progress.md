# SDD ledger — plan: docs/superpowers/plans/2026-10-02-booking-date-provenance-repair.md

Execution: Native; approved October 1, 2026 America/Denver. Draft PR #993.
Ruling: Use isolated feature-branch mirror and GitHub Git Data commits instead of a linked worktree — direct GitHub and npm network access are denied in the shell, while the repository connector works — cost if wrong: local mirror drift; compare every remote parent before committing.
Ruling: Run Vitest/PostgreSQL/build verification in GitHub Actions rather than install locally — npm registry access returns EACCES and no project dependencies are cached — cost if wrong: slower verification; do not claim success before reading CI results.
Pre-flight: Task 1 produces evidence/resolver/SQL consumed by Tasks 2–5; naming and field types consistent.
Pre-flight: Task 4 produces preview/apply DTOs consumed by Task 5; authenticated actor always comes from server, not proposal.
Task 1: started; BASE c760a5645adb58fb55043057a882bf9598ec2d10.
