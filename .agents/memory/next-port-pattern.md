---
name: Next→Vite/Express port pattern
description: Durable lessons from porting a Vercel/Next.js CRM into the pnpm monorepo (Vite frontend + Express API).
---

## Zod v4 on a v3 catalog
Ported code uses the zod v4 API while the workspace catalog pins 3.25.x (which ships v4 under `zod/v4`). **Why:** bumping the catalog risks other packages. **How to apply:** alias `zod` → `zod/v4` in each artifact's bundler config AND add a tsconfig `paths` entry pointing at `node_modules/zod/v4/index.d.ts` so TS types match runtime.

## Zod subpath alias caution
Beware of prefix-based bundler aliases when introducing dependencies that already import `zod/v4`: the `zod` → `zod/v4` alias can remap that subpath to the invalid `zod/v4/v4`. **Why:** esbuild package aliases also affect subpaths. **How to apply:** use exact-match resolution if such a dependency is needed; avoid loading unused runtime schema factories just to export a redundant validator.

## Shared schema typing without a runtime DB import
Frontend copies of server repositories typecheck against real Drizzle types by: (a) re-exporting `@workspace/db/schema` from `src/db/schema.ts`, (b) exposing `db` as `null as unknown as typeof realDb` via a type-only import in `src/db/client.ts`. No pg driver loads in the browser.

## Managed Clerk is cookie-based; owner restriction is fail-closed
Server uses `clerkMiddleware` + proxy; `requireOwnerMiddleware` compares every authenticated request to `OWNER_CLERK_USER_ID` and returns 403 if the env var is absent OR the user doesn't match — fails closed unconditionally. **Why:** single-owner CRM; any authenticated non-owner must be blocked. `OWNER_CLERK_USER_ID` is set in the shared environment as a non-secret env var (it's a user identifier, not a credential).

## Vite config: default PORT/BASE_PATH so production build is self-contained
Throw at dev-server startup was replaced with `?? '5000'` / `?? '/'` defaults so `pnpm run build` succeeds without env injection.

## Port sharp edges
- Verify repository/service method names against actual exports before using them; optimistic `?.()` calls silently no-op.
- Ported components keep their original prop contracts; pages must coerce ISO date strings to `Date` objects before passing down.
- Next `router.refresh()` after-save → no-op comment in wouter (pages re-fetch on navigation; `window.location.reload()` only if the original relied on a full server roundtrip).
- The platform path router handles `/api/*` → Express in production via `paths=["/api"]` in the api-server artifact.toml — no extra proxy config needed in the web artifact.
