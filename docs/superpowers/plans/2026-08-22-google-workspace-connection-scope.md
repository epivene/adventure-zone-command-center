# Google Workspace Connection and Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the single company Google account with server-side read-only OAuth, encrypt its credentials, inventory Gmail labels and Google Calendars, and let the owner approve the exact business scope before any historical content is imported.

**Architecture:** Add a focused `google-workspace` backend feature with a direct Google OAuth web-server flow and typed Gmail/Calendar/Drive adapters. Store one encrypted connection plus durable label/calendar selections in PostgreSQL, expose owner-only settings APIs and a public single-use OAuth callback, and add a settings page that previews the approved business roots and four calendars. This phase does not import message bodies, files, or events.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, Node `crypto` AES-256-GCM, `googleapis`, Zod, React/Vite/Wouter, TanStack Query, Vitest, PGlite, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

## Global Constraints

- Release 1 requests read-only Google access only: Gmail read-only, Calendar read-only, Drive read-only, and account identity.
- Use one connected company Google account.
- Gmail remains untouched: no send, archive, move, delete, or label mutations.
- Google Calendar remains untouched: no create, update, or delete operations.
- Scope is default-deny. No message or calendar content is imported until its Google ID belongs to an approved selection.
- Approved Gmail roots are `Shows`, `Receipts`, `Off Season Business Opportunities`, `Employees`, and `Associations`, including descendants.
- Approved calendars are Adventure Zone Calendar, Pirates Rebellion Calendar, Warriors Playground Calendar, and the separate calendar identified by `zone.pirate.warrior@gmail.com`.
- Google internal label/calendar IDs are authoritative after approval; names are display metadata.
- Only the owner can connect, disconnect, or change scope.
- Office Coordinator may later read approved business content, but cannot access credentials or connection settings.
- Leg-manager tokens must receive 401/404 from every Google Workspace endpoint.
- Refresh tokens and client secrets never reach the browser or logs.
- A callback state is single-use and expires after ten minutes.
- No sync/backfill worker starts in this phase.

---

### Task 1: Add Google API dependency and strict environment contract

**Files:**
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-env.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-env.test.ts`

**Interfaces:**

```ts
export type GoogleWorkspaceEnvironment = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: Uint8Array;
};

export function getGoogleWorkspaceEnvironment(
  env?: Record<string, string | undefined>,
): { configured: false } | { configured: true; value: GoogleWorkspaceEnvironment };
```

Environment variables:

```text
GOOGLE_WORKSPACE_CLIENT_ID
GOOGLE_WORKSPACE_CLIENT_SECRET
GOOGLE_WORKSPACE_REDIRECT_URI
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY
```

`GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY` is base64 for exactly 32 bytes. Partial configuration is an error; all four absent means `{ configured: false }`.

- [ ] **Step 1: Write the failing environment tests**

```ts
it("accepts a complete 32-byte key configuration", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  expect(getGoogleWorkspaceEnvironment({
    GOOGLE_WORKSPACE_CLIENT_ID: "client",
    GOOGLE_WORKSPACE_CLIENT_SECRET: "secret",
    GOOGLE_WORKSPACE_REDIRECT_URI: "https://api.example.com/api/google-workspace/oauth/callback",
    GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: key,
  })).toEqual(expect.objectContaining({ configured: true }));
});

it("rejects partial configuration", () => {
  expect(() => getGoogleWorkspaceEnvironment({
    GOOGLE_WORKSPACE_CLIENT_ID: "client",
  })).toThrow("GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-env.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add `googleapis` and implement strict parsing**

```bash
pnpm --filter @workspace/api-server add googleapis
```

Decode the key with `Buffer.from(value, "base64")`, require length 32, require an `https:` redirect URI outside tests, and never include secret values in thrown messages.

- [ ] **Step 4: Run the test and API typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-env.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/src/features/google-workspace/google-workspace-env*
git commit -m "feat: add Google Workspace environment contract"
```

---

### Task 2: Add the durable connection and scope schema

**Files:**
- Create: `lib/db/src/google-workspace-schema.ts`
- Create: `lib/db/migrations/20260822_google_workspace_foundation.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-schema-contract.test.ts`

**Interfaces / tables:**

```text
google_workspace_connections
  id uuid PK
  account_email text NOT NULL UNIQUE
  status text NOT NULL CHECK connected|reauthorization_required|disconnected
  encrypted_refresh_token jsonb NOT NULL
  granted_scopes jsonb NOT NULL CHECK array
  google_subject text
  connected_at timestamptz NOT NULL
  last_verified_at timestamptz
  disconnected_at timestamptz
  last_error_code text
  created_at / updated_at timestamptz

google_workspace_oauth_states
  state_hash text PK
  return_path text NOT NULL
  expires_at timestamptz NOT NULL
  consumed_at timestamptz
  created_at timestamptz NOT NULL

google_workspace_label_scopes
  id uuid PK
  connection_id uuid NOT NULL -> connections ON DELETE CASCADE
  label_id text NOT NULL
  label_name text NOT NULL
  root_label_id text NOT NULL
  root_label_name text NOT NULL
  selected boolean NOT NULL default true
  discovered_at / updated_at timestamptz
  UNIQUE(connection_id,label_id)

google_workspace_calendar_scopes
  id uuid PK
  connection_id uuid NOT NULL -> connections ON DELETE CASCADE
  calendar_id text NOT NULL
  summary text NOT NULL
  primary_calendar boolean NOT NULL default false
  selected boolean NOT NULL default true
  discovered_at / updated_at timestamptz
  UNIQUE(connection_id,calendar_id)

google_workspace_audit_events
  id uuid PK
  actor_kind text NOT NULL CHECK owner|office|system
  actor_id text
  action text NOT NULL
  target_type text NOT NULL
  target_id text
  metadata jsonb NOT NULL default '{}'
  created_at timestamptz NOT NULL
```

- [ ] **Step 1: Write the schema contract test**

Assert Drizzle exports, unique indexes, check constraints, foreign keys, and that the migration never stores plaintext columns named `refresh_token`, `access_token`, or `client_secret`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-schema-contract.test.ts
```

- [ ] **Step 3: Implement SQL and matching Drizzle schema**

Use `jsonb_typeof(granted_scopes) = 'array'` and `jsonb_typeof(encrypted_refresh_token) = 'object'`. Add indexes for active connection status, unconsumed OAuth state expiry, selected labels/calendars, and audit event date.

- [ ] **Step 4: Export schema through both DB entry points**

Add `googleWorkspaceSchema` to the spread passed to `drizzle(...)`, export it from `@workspace/db`, and mirror it from `artifacts/api-server/src/db/schema.ts`.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-workspace-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/google-workspace-schema.ts lib/db/migrations/20260822_google_workspace_foundation.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/google-workspace/google-workspace-schema-contract.test.ts
git commit -m "feat: add Google Workspace connection schema"
```

---

### Task 3: Guarantee the schema before the server listens

**Files:**
- Create: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/db/google-workspace-required-startup.ts`
- Create: `artifacts/api-server/src/db/google-workspace-required-startup.test.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Interfaces:**

```ts
export async function ensureGoogleWorkspaceSchema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean>;

export async function ensureGoogleWorkspaceSchemaBeforeListen(options?: {
  pool?: { connect(): Promise<StartupClient> };
  ensureSchema?: typeof ensureGoogleWorkspaceSchema;
}): Promise<boolean>;
```

- [ ] **Step 1: Write startup-order and advisory-lock tests**

```ts
it("ensures Google Workspace schema before app.listen", () => {
  const source = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");
  expect(source.indexOf('"required Google Workspace schema"'))
    .toBeLessThan(source.indexOf("const server = app.listen"));
});
```

Also prove `pg_try_advisory_lock(hashtext('adventure-zone:google-workspace-schema'))`, a five-second `lock_timeout`, unlock in `finally`, and immediate failure with `GOOGLE_WORKSPACE_SCHEMA_LOCK_BUSY`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/google-workspace-required-startup.test.ts
```

- [ ] **Step 3: Implement idempotent startup DDL**

Keep the startup migration limited to the new Google tables/indexes. Do not alter hot `organizations`, `contacts`, `bookings`, or `activities` tables in required startup.

- [ ] **Step 4: Call it before `app.listen`**

```ts
await runStartupStep(
  "required Google Workspace schema",
  ensureGoogleWorkspaceSchemaBeforeListen,
);
```

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/google-workspace-required-startup.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/db/google-workspace-* artifacts/api-server/src/index.ts
git commit -m "feat: require Google Workspace schema at startup"
```

---

### Task 4: Encrypt refresh tokens and enforce single-use OAuth state

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/encrypted-google-secret.ts`
- Create: `artifacts/api-server/src/features/google-workspace/encrypted-google-secret.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-oauth-state-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-oauth-state-repository.pglite.test.ts`

**Interfaces:**

```ts
export type EncryptedGoogleSecretV1 = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
};

export function encryptGoogleSecret(
  plaintext: string,
  key: Uint8Array,
): EncryptedGoogleSecretV1;

export function decryptGoogleSecret(
  payload: EncryptedGoogleSecretV1,
  key: Uint8Array,
): string;

export interface GoogleOAuthStateRepository {
  create(input: { state: string; returnPath: string; expiresAt: Date }): Promise<void>;
  consume(input: { state: string; now: Date }): Promise<{ returnPath: string } | null>;
  deleteExpired(now: Date): Promise<number>;
}
```

Only `sha256(state)` is stored. `consume` performs one atomic `UPDATE ... SET consumed_at = now() WHERE consumed_at IS NULL AND expires_at > now() RETURNING return_path`.

- [ ] **Step 1: Write crypto and replay tests**

Prove round-trip, random IVs, wrong-key failure, tampered-tag failure, state expiry, state replay rejection, and no plaintext token persisted in the PGlite row.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/google-workspace/encrypted-google-secret.test.ts \
  src/features/google-workspace/google-oauth-state-repository.pglite.test.ts
```

- [ ] **Step 3: Implement AES-256-GCM and repository transaction**

Use `randomBytes(12)` for IVs, base64url fields, and `timingSafeEqual` only where equal-length comparisons are needed. Never log payloads.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/encrypted-google-secret.test.ts src/features/google-workspace/google-oauth-state-repository.pglite.test.ts
git add artifacts/api-server/src/features/google-workspace/encrypted-google-secret* artifacts/api-server/src/features/google-workspace/google-oauth-state-repository*
git commit -m "feat: secure Google OAuth credentials and state"
```

---

### Task 5: Add typed read-only Google API clients

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-connection-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-connection-repository.pglite.test.ts`

**Interfaces:**

```ts
export const GOOGLE_WORKSPACE_READ_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

export type GoogleLabelSummary = { id: string; name: string; type: "system" | "user" };
export type GoogleCalendarSummary = { id: string; summary: string; primary: boolean };

export interface GoogleWorkspaceReadClient {
  authorizationUrl(input: { state: string }): string;
  exchangeCode(code: string): Promise<{ refreshToken: string; scopes: string[] }>;
  accountIdentity(): Promise<{ subject: string | null; email: string }>;
  listLabels(): Promise<GoogleLabelSummary[]>;
  listCalendars(): Promise<GoogleCalendarSummary[]>;
}

export function createGoogleWorkspaceReadClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken?: string;
}): GoogleWorkspaceReadClient;
```

- [ ] **Step 1: Write adapter tests with injected fake OAuth/Gmail/Calendar clients**

Prove the authorization URL requests offline access and consent, the exact read-only scope list, refresh-token preservation when Google omits a new refresh token, and normalized label/calendar output.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-api-client.test.ts src/features/google-workspace/google-connection-repository.pglite.test.ts
```

- [ ] **Step 3: Implement the provider adapter and connection repository**

The repository owns encrypt/decrypt boundaries. Callers receive an authenticated `GoogleWorkspaceReadClient`, never the encrypted JSON or plaintext refresh token.

- [ ] **Step 4: Handle revoked tokens safely**

Map Google `invalid_grant` to `GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED`, set connection status accordingly, retain scope selections, and clear no business data.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-api-client.test.ts src/features/google-workspace/google-connection-repository.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/google-api-* artifacts/api-server/src/features/google-workspace/google-connection-repository*
git commit -m "feat: add read-only Google Workspace client"
```

---

### Task 6: Implement owner OAuth and connection settings routes

**Files:**
- Create: `artifacts/api-server/src/routes/google-workspace-oauth-callback.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-oauth-callback.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-settings.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-settings.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-scope-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-scope-service.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Public callback:**

```text
GET /google-workspace/oauth/callback?code=...&state=...
```

**Owner-only routes:**

```text
POST /google-workspace/oauth/start
GET  /google-workspace/settings
POST /google-workspace/scope/preview
PUT  /google-workspace/scope
POST /google-workspace/disconnect
```

`POST /google-workspace/oauth/start` returns `{ authorizationUrl }`. The callback exchanges the code, verifies the account identity, encrypts the refresh token, records audit metadata without secrets, consumes state once, and redirects to `/settings/google-workspace?connected=1`.

Scope payload:

```ts
export type ApprovedGoogleScopeInput = {
  labelIds: string[];
  calendarIds: string[];
};
```

- [ ] **Step 1: Write route tests before implementation**

Cover missing configuration, missing code/state, expired/replayed state, account exchange failure, successful redirect, exact account email returned in settings, disconnect, and strict unknown-field rejection.

- [ ] **Step 2: Write scope-service tests**

Given labels named `Shows`, `Shows/2026`, `Shows/West`, and `Personal`, the preview recommends the first three and excludes `Personal`. Match root names case-insensitively, preserve exact Google IDs, and report a named root as missing rather than guessing a similarly named label.

Given calendar summaries, recommend exactly the four approved calendars; use the email identifier for the fourth calendar when its summary differs.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-scope-service.test.ts src/routes/google-workspace-oauth-callback.test.ts src/routes/google-workspace-settings.test.ts
```

- [ ] **Step 4: Mount the callback before owner middleware and settings after it**

```ts
router.use(googleWorkspaceOAuthCallbackRouter);
// office and manager public routers
router.use(requireOwnerMiddleware);
router.use(googleWorkspaceSettingsRouter);
```

Never mount scope settings in Office or manager route groups.

- [ ] **Step 5: Add cross-role security assertions**

Office and leg-manager bearer tokens must fail on `/google-workspace/settings`, `/scope`, `/oauth/start`, and `/disconnect`. The public callback accepts no bearer authority and can only succeed with an unexpired single-use state.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-scope-service.test.ts src/routes/google-workspace-oauth-callback.test.ts src/routes/google-workspace-settings.test.ts src/routes/office-auth.test.ts src/routes/leg-manager-auth.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/google-scope-service* artifacts/api-server/src/routes/google-workspace-* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add Google Workspace connection routes"
```

---

### Task 7: Build the owner connection and scope-preview page

**Files:**
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.test.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-scope-preview.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-scope-preview.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`

**Client DTO:**

```ts
export type GoogleWorkspaceSettingsView = {
  configured: boolean;
  connection: null | {
    email: string;
    status: "connected" | "reauthorization_required" | "disconnected";
    grantedScopes: string[];
    connectedAt: string;
  };
  labels: Array<{ id: string; name: string; selected: boolean; rootName: string }>;
  calendars: Array<{ id: string; summary: string; selected: boolean; primary: boolean }>;
};
```

- [ ] **Step 1: Write client and page tests**

Prove Connect opens the returned authorization URL, scope preview clearly separates Recommended, Missing expected labels/calendars, and Excluded; Save Scope sends only IDs; Disconnect requires confirmation; secrets never appear in rendered data.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace/google-workspace-client.test.ts src/components/google-workspace/google-scope-preview.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx
```

- [ ] **Step 3: Implement the page**

Use clear copy:

```text
Google Workspace
Read-only connection for approved company Gmail labels, files, and calendars.
Gmail and Google Calendar will not be changed.
```

Show the five approved label roots and four approved calendars by name before saving. Disable historical-backfill controls; those arrive in the next plan.

- [ ] **Step 4: Add owner route and menu entry**

```tsx
<Route path="/settings/google-workspace" component={SettingsGoogleWorkspacePage} />
```

Add `Google Workspace` under `Imports & Data` or `Settings`, not in Office Coordinator or leg-manager menus.

- [ ] **Step 5: Run frontend checks and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace/google-workspace-client.test.ts src/components/google-workspace/google-scope-preview.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage* artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx
git commit -m "feat: add Google Workspace scope setup UI"
```

---

### Task 8: Add the foundation CI gate and deployment checklist

**Files:**
- Create: `.github/workflows/google-workspace-sync-ci.yml`
- Create: `docs/operations/google-workspace-readonly-setup.md`

- [ ] **Step 1: Add a focused workflow**

```yaml
name: Google Workspace Sync CI
on:
  pull_request:
    paths:
      - "artifacts/api-server/src/features/google-workspace/**"
      - "artifacts/api-server/src/routes/google-workspace-*.ts"
      - "artifacts/api-server/src/db/google-workspace-*.ts"
      - "artifacts/adventure-zone/src/features/google-workspace/**"
      - "artifacts/adventure-zone/src/components/google-workspace/**"
      - "artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage*"
      - "lib/db/src/google-workspace-schema.ts"
      - "lib/db/migrations/*google_workspace*"
      - ".github/workflows/google-workspace-sync-ci.yml"
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-oauth-callback.test.ts src/routes/google-workspace-settings.test.ts src/db/google-workspace-required-startup.test.ts
      - run: pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
      - run: pnpm --filter @workspace/api-server build
      - run: pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 2: Document exact Google Cloud setup**

Document enabling Gmail API, Calendar API, Drive API, creating a Web application OAuth client, registering the Render callback URI, setting the four environment variables, granting the read-only scopes, connecting the company account, previewing scope, and verifying that no content backfill begins in this phase.

- [ ] **Step 3: Run the complete phase verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-oauth-callback.test.ts src/routes/google-workspace-settings.test.ts src/db/google-workspace-required-startup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/google-workspace-sync-ci.yml docs/operations/google-workspace-readonly-setup.md
git commit -m "ci: verify Google Workspace connection foundation"
```

## Phase Acceptance

- The owner can connect the single company Google account with server-side offline OAuth.
- Refresh credentials are encrypted and never returned to the browser.
- The settings page inventories Gmail labels and all calendars.
- The five business label roots and four calendars are explicitly previewed and saved by Google ID.
- Personal/unselected content is default-denied.
- Office Coordinator and leg-manager credentials cannot access connection settings.
- Gmail, Drive, and Calendar are not mutated.
- No historical content is imported yet.
