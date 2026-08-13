# Adventure Zone Command Center

A CRM and scheduling tool for an adventure tour company. Manages bookings, contacts, routes, and imported Act! CRM history — all in one place.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/adventure-zone run dev` — run the frontend (Vite)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` or `RENDER_DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Wouter (SPA, no SSR)
- API: Express 5 (all routes under `/api`)
- DB: PostgreSQL + Drizzle ORM (`lib/db`)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Auth: HMAC bearer tokens (`OWNER_PASSWORD` + `SESSION_SECRET`)
- Build: esbuild (ESM bundle for API)

## Where things live

- `artifacts/adventure-zone/` — React frontend
- `artifacts/api-server/` — Express API
- `lib/db/` — Drizzle schema + migrations (`@workspace/db`)
- `lib/api-zod/` — Zod schemas generated from the OpenAPI spec
- `lib/integrations-anthropic-ai/` — Replit-managed Anthropic proxy client

## Architecture decisions

- Auth is a single owner/password — no user accounts. All API routes are protected by `requireOwnerMiddleware`.
- DB connection: `RENDER_DATABASE_URL` takes priority over `DATABASE_URL`; SSL is appended automatically.
- AI suggestions use a provider-agnostic client (`ai-client.ts`) that picks the first available key in priority order (see below).
- Act! CRM data is imported into the `activities` table; the app runs standalone without Act! going forward.
- Travel leg ordering: active legs hold sort positions 1..N, archived legs trail; enforced in the service layer.

## Production environment variables (Render)

Set these on the **Render dashboard** → your web service → **Environment**.

| Variable | Purpose |
|---|---|
| `RENDER_DATABASE_URL` | Postgres connection string (required) |
| `OWNER_PASSWORD` | Login password for the owner UI (required) |
| `SESSION_SECRET` | HMAC secret for auth tokens — keep long and random (required) |
| `OPENAI_API_KEY` | Enables AI booking suggestions via OpenAI `gpt-4o-mini` |
| `ANTHROPIC_API_KEY` | Enables AI booking suggestions via Anthropic `claude-3-5-haiku` |

**AI provider priority**: If `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are both set, Anthropic is used. Inside Replit, the managed Anthropic proxy takes priority over both and no key is needed.

You only need **one** of `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` for the AI suggestions feature to work on Render.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `pnpm --filter @workspace/db run push` requires an interactive TTY; run it with `pnpm --filter @workspace/db run push 2>&1 < /dev/tty` if needed from a script.
- The Replit AI proxy vars (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL`, `AI_INTEGRATIONS_ANTHROPIC_API_KEY`) are **only** available inside Replit — they are not forwarded to Render. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` on Render instead.
- esbuild bundles the API as ESM (`dist/index.mjs`); dynamic `import()` statements in routes are preserved correctly.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
- DB schema source of truth: `lib/db/src/schema/index.ts`
- API auth middleware: `artifacts/api-server/src/lib/auth.ts`
- AI client factory: `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`
