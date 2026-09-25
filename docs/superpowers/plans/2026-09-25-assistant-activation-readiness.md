# Assistant activation readiness implementation

Spec: docs/superpowers/specs/2026-09-25-assistant-activation-readiness.md
Base: e9a40c51e2e395fcc3b1bee00c56a0889c3eea33

Global constraints: native inline implementation; agents read-only except final fresh review; no production mutation/provider call; preserve unrelated main updates when publishing draft PR. Tests use controlled configuration, PGlite, and network boundaries. No secret values in status or browser UI.

## Task 1: Readiness and startup gate
Add failing configuration, real SQL readiness, startup failure, authenticated status and route-gate tests. Run focused tests (Expected: missing readiness/gating assertions fail). Implement safe structured config diagnostics, independent read-only readiness service, and lifecycle gate wired to index/router. Re-run affected tests (Expected: pass). Commit.
Interfaces: status extends existing model fields with ready, checks and providerVerification. Router readiness uses current actor and lightweight dependencies; it never constructs runtime/providers. Startup gate supplies starting/ready/failed state.

## Task 2: Owner setup UI and deployment instructions
Test blocked/ready status presentation, refresh/error recovery, Google link and no conversation calls while unavailable (Expected: fail before UI change). Implement panel and wire page refresh using ready; retain status visibility while chat is available. Add disabled Render env block and activation runbook. Run workspace UI tests and builds (Expected: pass). Commit.
Interfaces: UI consumes Task 1 safe readiness response; enabled alone never opens chat.

## Task 3: CI repair and final validation
Replace malformed one-off workflow with intended read-only verification; add assistant regression/build workflow and align startup CI Node version. Fix ambiguous pre-existing booking UI badge assertion. Parse all YAML (Expected: zero failures); run booking focused tests, assistant regression selection, UI tests, API/UI builds, and compare affected type errors to baseline (Expected: green tests/builds, no new type errors). Commit. Fresh whole-branch review on gpt-6-astra; fix important findings using reproductions. Publish draft PR atop latest remote main, preserving every unrelated blob.

## Review Focus
Check disabled and partially configured states, owner exclusion, initializer failure followed by worker startup, missing or stale schema despite migration filename, provider exceptions and credential leakage, optional Google failure independence, stale UI readiness, and CI command/path coverage. Provider credentials, native PostgreSQL, and browser rendering of unreleased code remain unverified unless directly exercised.
