# Test Suite Foundation Repair Design

## Purpose

Restore a trustworthy test foundation for Adventure Zone without changing current product behavior merely to satisfy stale assertions. This repair is separate from the protected-document review feature shipped in PR #736.

## Evidence and current state

- The local machine runs Node 26.2.0 on Windows, while GitHub Actions consistently targets Node 22 on Ubuntu.
- Running the Adventure Zone suite on Node 26 produced 226 failed tests across 112 failed files.
- Running the same suite on Node 22 reduced that to 152 failed tests across 100 failed files, proving that the unsupported local runtime accounts for a large cascade.
- Thirteen suites fail before their tests can run. Their causes include missing `@testing-library/user-event`, Zod 4-style `z.uuid()` usage with the installed Zod 3.25.76, Windows-incompatible file URL/path assumptions, incorrect repository-relative paths, and one invalid Vitest mock-hoisting pattern.
- The production frontend build succeeds after manually supplying the Windows Lightning CSS binary. The workspace currently excludes that binary through pnpm overrides, so a normal Windows install cannot reproduce the build.
- Release Safety also fails on pre-existing API test-fixture type drift across unrelated domains. Those failures are not caused by PR #736.

## Goals

1. Make the repository declare and enforce the same Node 22 major version used by CI.
2. Make pnpm installation and the Adventure Zone build work on Windows without manual dependency copying.
3. Eliminate objective test-suite load/setup errors so every test file can execute.
4. Produce a machine-readable inventory of the remaining behavioral failures grouped by product domain.
5. Repair genuine regressions only when the current product contract is clear; route contradictory or obsolete expectations into small follow-up designs.

## Non-goals

- Do not rewrite 152 expectations to match whatever the current source happens to contain.
- Do not revert newer navigation, calling, profile, or workspace behavior without an explicit product decision.
- Do not mix broad test cleanup into the already-merged document-review feature.
- Do not make the full suite green by excluding, skipping, or weakening tests.

## Approach

### 1. Align runtime and installation

Declare Node 22 in repository metadata and add a version file recognized by common Node managers. Replace the POSIX-only root `preinstall` shell expression with a small cross-platform Node script that preserves its two contracts: remove conflicting npm/yarn lockfiles and reject non-pnpm installs.

Remove only the Windows x64 native-package exclusions required by the supported Windows development path. Keep unrelated platform exclusions intact. Regenerate the pnpm lockfile on the declared runtime and prove that a clean Windows dependency install supplies the native CSS/build packages automatically.

### 2. Repair deterministic suite-load defects

Treat each load failure as its own red-green repair:

- add the missing `@testing-library/user-event` test dependency;
- replace Zod 4-only `z.uuid()` with the installed Zod 3-compatible `z.string().uuid()` while preserving lowercase normalization;
- replace `import.meta.url` filesystem assumptions in affected tests with stable test-directory resolution;
- correct repository-relative test paths that currently duplicate or omit workspace segments;
- move Vitest mock values into `vi.hoisted()` where the framework requires hoisting;
- update stale typed fixtures only when the production interface clearly defines the missing field or signature.

These changes may touch test infrastructure, tests, and narrowly implicated production validation code. They must not alter visible app behavior.

### 3. Inventory remaining behavioral failures

Run the complete Adventure Zone suite under Node 22 after the setup repairs. Record each remaining failure with:

- product domain;
- failing test and assertion;
- last meaningful production/test commits;
- classification: confirmed regression, stale expectation, or needs product decision;
- recommended follow-up slice.

Confirmed regressions with an unambiguous current contract may be fixed in isolated commits using TDD. Stale or contradictory assertions require a separate bounded or architectural design before changing tests or product code.

## Verification

- A normal Windows `pnpm install` completes without requiring `sh` or a manually copied native binary.
- `pnpm --filter @workspace/adventure-zone build` succeeds after that install.
- All thirteen currently identified suite-load failures are reproduced before their individual repairs and execute afterward.
- The full suite is run under Node 22, with before/after totals recorded.
- Existing document-review tests remain green.
- No tests are skipped and the Vitest include pattern is not narrowed.

## Delivery

Deliver the foundation repair as its own pull request. The remaining behavioral work is split into domain-specific follow-ups so reviewers can distinguish deliberate product changes from test-maintenance corrections.
