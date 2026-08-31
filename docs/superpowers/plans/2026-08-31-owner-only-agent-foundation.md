# Owner-Only Agent Foundation Implementation Plan

> For agentic workers: execute each task in order, keep production changes behind tests, and do not merge until the owner-boundary checks, typecheck, and build pass.

**Goal:** Replace the shared blank owner actor and non-revocable owner token with one database-backed Desiree owner identity while preserving the existing password entry flow and keeping every owner assistant/admin route inaccessible to Office and manager credentials.

**Architecture:** Add a singleton `owner_accounts` table and a PostgreSQL repository. Pure HMAC token helpers encode owner ID, session version, and expiry. An async middleware resolves every bearer token against the active database account. The existing `OWNER_PASSWORD` is a one-time compatibility bootstrap only when no owner row exists; there is no registration endpoint. Existing owner route placement remains after the owner middleware gate.

**Tech stack:** TypeScript, Express 5, PostgreSQL, Drizzle schema declarations, Node `crypto`, Vitest, Supertest, pnpm, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-31-owner-only-agent.md`

---

## Task 1: Lock the contract with failing tests

**Files:**
- Create: `artifacts/api-server/src/features/owner-auth/owner-token.test.ts`
- Create: `artifacts/api-server/src/features/owner-auth/owner-middleware.test.ts`
- Create: `artifacts/api-server/src/routes/auth.test.ts`
- Create: `lib/db/src/owner-auth-schema.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`
- Create: `.github/workflows/owner-agent-foundation-ci.yml`

Cover token-family separation, tamper/expiry rejection, database session-version validation, singleton bootstrap, no second-owner creation path, revoke-all behavior, redacted API responses, and schema-before-listen ordering. Open a draft PR and confirm the targeted workflow fails because the new modules do not yet exist.

## Task 2: Add the singleton owner schema

**Files:**
- Create: `lib/db/src/owner-auth-schema.ts`
- Create: `lib/db/migrations/20260831_owner_account.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/drizzle-schema.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`

Define one `primary` singleton row, one `owner` role, salted credential fields, enabled state, positive session version, and timestamps. Export the table through all schema entrypoints.

## Task 3: Guarantee owner schema before listen

**Files:**
- Create: `artifacts/api-server/src/db/owner-account-startup-migration.ts`
- Create: `artifacts/api-server/src/db/owner-account-required-startup.ts`
- Create: `artifacts/api-server/src/db/owner-account-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`

Use a PostgreSQL advisory lock and idempotent `CREATE TABLE/INDEX` statements. Run it as the first required authentication schema step before the server starts accepting requests.

## Task 4: Implement stable owner credentials and tokens

**Files:**
- Create: `artifacts/api-server/src/features/owner-auth/owner-account-repository.ts`
- Create: `artifacts/api-server/src/features/owner-auth/owner-token.ts`
- Create: `artifacts/api-server/src/features/owner-auth/owner-middleware.ts`
- Modify: `artifacts/api-server/src/lib/auth.ts`

The repository reads the primary owner, creates it exactly once under an advisory transaction lock, validates active sessions, and increments the session version. Token helpers use the `owner.<id>.<version>.<expiry>.<signature>` family. Keep temporary `issueToken`/`verifyToken` compatibility exports for existing tests while moving production middleware to the database-backed path.

## Task 5: Upgrade owner routes and route gate

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/app.ts`

Make login asynchronous. Existing database credentials take precedence. Only when no owner exists may the configured `OWNER_PASSWORD` bootstrap Desiree's salted credential. Return a redacted owner view. Add `POST /auth/sign-out-all` to increment the session version. Mount all owner assistant/admin APIs behind the database-resolving middleware.

## Task 6: Preserve the current owner experience

**Files:**
- Modify: `artifacts/adventure-zone/src/lib/auth-context.tsx`

Continue accepting a password-only form. Track the owner identity returned by `/auth/me`, and expose a sign-out-all action that clears local assistant caches and the owner token after the server revokes all sessions.

## Task 7: Verify and prepare the next agent slice

Run the targeted owner tests, existing Office security regression, existing manager auth tests, workspace typecheck, and workspace build in GitHub Actions. Review the complete diff for accidental public routes, secret exposure, or token-family crossover. Mark the PR ready only when all checks pass. The next branch begins persistent conversation memory; it must not be mixed into this security foundation until this PR is green.
