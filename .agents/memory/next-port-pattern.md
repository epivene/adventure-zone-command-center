---
name: Next→Vite/Express port pattern
description: Durable lessons from porting a Vercel/Next.js CRM into the pnpm monorepo (Vite frontend + Express API).
---

## Zod v4 on a v3 catalog
Ported code uses the zod v4 API while the workspace catalog pins 3.25.x (which ships v4 under the `zod/v4` subpath). **Why:** bumping the catalog risks other packages. **How to apply:** alias `zod` → `zod/v4` in each artifact's bundler config AND add a tsconfig `paths` entry pointing at `node_modules/zod/v4/index.d.ts` so types match runtime.

## Shared-schema typing across artifacts
- Composite TS packages (lib/db) serve types from `dist/*.d.ts` — if feature code reports "no exported member" for tables that clearly exist, rebuild the lib's declarations (`tsc -b lib/db --force`) before assuming code is wrong.
- Frontend copies of server repositories can typecheck against the real schema without pulling in pg: re-export the schema from the shared package and expose `db` as `null as unknown as typeof realDb` via a type-only import.

## Managed Clerk is cookie-based
Server: `clerkMiddleware` + proxy; owner check enforced only when OWNER_CLERK_USER_ID is set. Frontend: `publishableKeyFromHost`, fetches with `credentials: "include"`. **Why:** the original app used external Clerk Bearer tokens — do not reintroduce token getters for web.

## Port sharp edges
- Verify repository/service method names against actual exports; optimistic `?.()` calls silently no-op.
- Ported components keep original prop contracts; pages must adapt API JSON (coerce ISO strings to Date) before passing down.
- Vite artifact configs should default `BASE_PATH`/`PORT` instead of throwing, so `pnpm run build` is self-contained for production.
- Next `router.refresh()` after-save has no wouter equivalent; a no-op is usually fine because pages re-fetch on navigation.
