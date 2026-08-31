# Design Studio Canva Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Canva Connect workflow so the current Command Center visual design can be imported into Canva as an editable Canva design, then reopened later with Continue in Canva.

**Architecture:** Keep Command Center as source of truth. The browser saves the current canvas first, requests a server-side Canva import, and receives durable Canva metadata plus a fresh edit URL. The server owns OAuth secrets/tokens and Canva API calls. The initial transport format is PDF because the existing editor plan exposes `exportCanvasPdf`; flattened PNG remains a fallback only for diagnostics, not the intended handoff.

**Tech Stack:** Express, TypeScript, existing authenticated Design Studio routes, Drizzle/PostgreSQL, Canva Connect OAuth/API, existing Design Studio export boundary, Vitest/server integration tests.

**Spec:** `docs/superpowers/specs/2026-08-31-design-studio-canva-handoff-design.md`

## Global Constraints

- Do not require Canva Pro, Brand Kit, Brand Templates, Autofill, Magic Resize, or Canva AI generation.
- Do not copy/paste text as the normal workflow.
- Never expose Canva client secrets or refresh tokens to browser code.
- Canva failure must never block in-app editing or destroy the Command Center canvas.
- Persist durable Canva design identity; treat edit URLs as refreshable/temporary.
- Continue in Canva must reopen the same design instead of generating duplicates.
- Re-export after newer Command Center edits must require an explicit choice; never silently overwrite an existing Canva design.
- PDF is the initial import source; preserve text/vector structure as far as the export/import stack allows.

---

### Task 1: Add structured Canva connection and project metadata tables

**Files:**
- Modify: `lib/db/src/design-studio-schema.ts`
- Modify: `lib/db/src/index.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Create: `artifacts/api-server/src/features/design-studio/canva-metadata.integration.test.ts`

**Interfaces:**
- Produces `designCanvaConnections` and `designProjectCanvaLinks` database tables.
- Later server tasks consume those tables rather than storing `CANVA_URL=` inside project notes.

- [ ] **Step 1: Write failing schema/integration test**

```ts
it("stores durable Canva design metadata separately from project notes", async () => {
  const link = await repository.upsertCanvaProjectLink({
    projectId,
    designId: "D1234567890",
    importedVersionId: versionId,
    status: "ready",
  });
  expect(link.designId).toBe("D1234567890");
  expect(link.importedVersionId).toBe(versionId);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-metadata.integration.test.ts
```
Expected: FAIL because Canva metadata tables/repository do not exist.

- [ ] **Step 3: Add connection table**

Define fields:
```ts
id: uuid primary key
officeAccountId: uuid -> office_accounts
canvaUserId: text nullable
accessTokenEncrypted: text
refreshTokenEncrypted: text nullable
tokenExpiresAt: timestamp nullable
scopes: jsonb string[]
status: "connected" | "disconnected" | "error"
createdAt / updatedAt
```

- [ ] **Step 4: Add project Canva link table**

Define fields:
```ts
id: uuid primary key
projectId: uuid unique -> design_projects onDelete cascade
designId: text not null
importedVersionId: uuid -> design_project_versions
status: "pending" | "ready" | "failed"
lastImportAt: timestamp
lastError: text nullable
createdAt / updatedAt
```

- [ ] **Step 5: Add startup/schema verification and repository helpers**

Expose helpers:
```ts
getCanvaConnection(accountId)
upsertCanvaConnection(input)
getProjectCanvaLink(projectId)
upsertProjectCanvaLink(input)
```

- [ ] **Step 6: Run test and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-metadata.integration.test.ts
pnpm --filter @workspace/api-server typecheck
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/design-studio-schema.ts lib/db/src/index.ts artifacts/api-server/src/db/required-schema-startup.ts artifacts/api-server/src/features/design-studio/canva-metadata.integration.test.ts
git commit -m "feat: add structured Canva design metadata"
```

---

### Task 2: Add Canva OAuth server boundary

**Files:**
- Create: `artifacts/api-server/src/features/design-studio/canva-client.ts`
- Create: `artifacts/api-server/src/features/design-studio/canva-oauth.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Create: `artifacts/api-server/src/features/design-studio/canva-oauth.test.ts`

**Interfaces:**
- Consumes environment variables `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`, `CANVA_REDIRECT_URI`.
- Produces `buildCanvaAuthorizeUrl(state)`, `exchangeCanvaCode(code)`, `refreshCanvaToken(refreshToken)`, and authenticated Canva request helper.

- [ ] **Step 1: Write failing OAuth tests**

```ts
it("builds an authorization URL with state and required scopes", () => {
  const url = new URL(buildCanvaAuthorizeUrl("state-123"));
  expect(url.searchParams.get("state")).toBe("state-123");
  expect(url.searchParams.get("client_id")).toBe(process.env.CANVA_CLIENT_ID);
});

it("never returns the client secret in browser-facing connection status", async () => {
  const status = await getConnectionStatus(accountId);
  expect(JSON.stringify(status)).not.toContain(process.env.CANVA_CLIENT_SECRET!);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-oauth.test.ts
```

- [ ] **Step 3: Implement OAuth helpers and encrypted token storage**

Use the app's existing secret/encryption pattern if one exists; do not create plaintext token columns. Fail startup/configuration with an actionable message only when Canva endpoints are invoked, because Canva is optional.

- [ ] **Step 4: Add connection routes**

Add authenticated routes:
```text
GET  /office/design-studio/canva/status
POST /office/design-studio/canva/connect
GET  /office/design-studio/canva/callback
POST /office/design-studio/canva/disconnect
```

`connect` returns an authorization URL. `callback` validates state, exchanges code, stores tokens, and redirects back to Design Studio.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-oauth.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/design-studio/canva-client.ts artifacts/api-server/src/features/design-studio/canva-oauth.ts artifacts/api-server/src/features/design-studio/canva-oauth.test.ts artifacts/api-server/src/routes/office-design-studio.ts
git commit -m "feat: add Canva OAuth connection"
```

---

### Task 3: Add server-side Canva design import service

**Files:**
- Create: `artifacts/api-server/src/features/design-studio/canva-import-service.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Create: `artifacts/api-server/src/features/design-studio/canva-import-service.test.ts`

**Interfaces:**
- Consumes: connected Canva account, project/version, PDF upload bytes or storage reference.
- Produces: `{ designId: string; editUrl: string; importedVersionId: string }`.

- [ ] **Step 1: Write failing import-service test**

```ts
it("creates a Canva design import and persists the returned design id", async () => {
  canvaFetch.mockResolvedValueOnce(importJobCreated).mockResolvedValueOnce(importJobComplete);
  const result = await importProjectToCanva({ accountId, projectId, versionId, pdf });
  expect(result.designId).toBe("D1234567890");
  expect(await repository.getProjectCanvaLink(projectId)).toMatchObject({ designId: "D1234567890" });
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-import-service.test.ts
```

- [ ] **Step 3: Implement import lifecycle**

Service sequence:
```text
ensure connected token → refresh if expired → submit import → poll import job with bounded retries → persist designId/importedVersionId/status → fetch/return edit URL
```

Use bounded retry timing and surface Canva response errors without mutating the source canvas.

- [ ] **Step 4: Add project import route**

```text
POST /office/design-studio/projects/:projectId/canva/import
```

Request body:
```ts
{
  versionId: string;
  sourceStorageKey: string;
}
```

The server must verify the version belongs to the owned project.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-import-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/design-studio/canva-import-service.ts artifacts/api-server/src/features/design-studio/canva-import-service.test.ts artifacts/api-server/src/routes/office-design-studio.ts
git commit -m "feat: import Design Studio projects into Canva"
```

---

### Task 4: Add a temporary source-artifact endpoint for the PDF handoff

**Files:**
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Create: `artifacts/api-server/src/features/design-studio/canva-source-artifact.test.ts`

**Interfaces:**
- Consumes: PDF `Blob` generated by `exportCanvasPdf` from the editor plan.
- Produces: project/version-scoped temporary source artifact with a storage key that the import service can consume.

- [ ] **Step 1: Write failing upload test**

```ts
it("stores a Canva source PDF against the owned project version", async () => {
  const result = await uploadCanvaSource({ projectId, versionId, mimeType: "application/pdf", bytes });
  expect(result.storageKey).toContain(projectId);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-source-artifact.test.ts
```

- [ ] **Step 3: Add upload endpoint**

```text
POST /office/design-studio/projects/:projectId/canva/source
Content-Type: application/pdf
```

Return:
```ts
{ storageKey: string; versionId: string }
```

Store in existing private object storage under a bounded prefix such as:
```text
design-studio/canva-source/<projectId>/<versionId>.pdf
```

- [ ] **Step 4: Add client API helpers**

```ts
uploadCanvaSource(projectId: string, versionId: string, pdf: Blob)
importToCanva(projectId: string, input: { versionId: string; sourceStorageKey: string })
getCanvaStatus()
getProjectCanvaState(projectId: string)
```

- [ ] **Step 5: Run tests + client/server typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio/canva-source-artifact.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/office-design-studio.ts artifacts/api-server/src/features/design-studio/canva-source-artifact.test.ts artifacts/adventure-zone/src/lib/design-studio-api.ts
git commit -m "feat: add Canva source PDF upload"
```

---

### Task 5: Add Open in Canva / Continue in Canva UI state machine

**Files:**
- Create: `artifacts/adventure-zone/src/components/design-studio/CanvaHandoffButton.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/CanvaHandoffButton.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`

**Interfaces:**
- Consumes: connection status, project Canva metadata, saved/current version identity, `exportCanvasPdf`.
- Produces UI states: disconnected, first import, importing, continue, stale Canva copy, failed/retry.

- [ ] **Step 1: Write failing state-machine tests**

```tsx
it("shows Connect Canva when disconnected", () => {
  render(<CanvaHandoffButton state={{ connection: "disconnected" }} />);
  expect(screen.getByRole("button", { name: /connect canva/i })).toBeInTheDocument();
});

it("shows Continue in Canva when current version was already imported", () => {
  render(<CanvaHandoffButton state={{ connection: "connected", designId: "D123", isCurrent: true, editUrl: "https://www.canva.com/design/D123" }} />);
  expect(screen.getByRole("button", { name: /continue in canva/i })).toBeInTheDocument();
});

it("offers existing or new copy when Command Center is newer", () => {
  render(<CanvaHandoffButton state={{ connection: "connected", designId: "D123", isCurrent: false }} />);
  expect(screen.getByText(/newer changes/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/CanvaHandoffButton.test.tsx
```

- [ ] **Step 3: Implement first-import flow**

Sequence in browser:
```ts
await savePendingChanges();
const pdf = await exportCanvasPdf(editor.doc, assets);
const source = await designStudioApi.uploadCanvaSource(project.id, savedVersionId, pdf);
const imported = await designStudioApi.importToCanva(project.id, source);
window.open(imported.editUrl, "_blank", "noopener,noreferrer");
```

- [ ] **Step 4: Implement existing-design flow**

When current version matches `importedVersionId`, open a fresh returned edit URL for the same `designId` and do not import again.

- [ ] **Step 5: Implement stale-copy decision dialog**

Offer exactly:
```text
Open existing Canva version
Create new Canva copy from current version
Cancel
```

Never overwrite automatically.

- [ ] **Step 6: Run tests + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/CanvaHandoffButton.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/design-studio/CanvaHandoffButton.tsx artifacts/adventure-zone/src/components/design-studio/CanvaHandoffButton.test.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx
git commit -m "feat: add real Open in Canva handoff"
```

---

### Task 6: Remove legacy note-based Canva-link UI and run end-to-end acceptance

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Create: `artifacts/adventure-zone/src/pages/DesignStudioCanvaAcceptance.test.tsx`

**Interfaces:**
- Removes `CANVA_URL=` note parsing as the normal path.
- Preserves migration/read compatibility only long enough to avoid breaking existing saved projects.

- [ ] **Step 1: Write acceptance regression test**

```tsx
it("never asks the user to copy prepared text into Canva", async () => {
  render(<DesignStudioEditorPage />);
  expect(screen.queryByText(/copy into canva/i)).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: /open in canva|continue in canva|connect canva/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED if legacy copy UI still remains**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/DesignStudioCanvaAcceptance.test.tsx
```

- [ ] **Step 3: Remove note-link controls and retain optional migration parsing only**

If an old project contains `CANVA_URL=...`, display no text field. A one-time server/client migration helper may copy the URL into structured metadata only when enough durable identity is available; otherwise treat it as a legacy external link without pretending it is managed Canva state.

- [ ] **Step 4: Run full verification**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/design-studio src/components/design-studio src/pages/DesignStudioCanvaAcceptance.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/design-studio
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone build
```
Expected: PASS.

- [ ] **Step 5: Manual acceptance**

Verify:
```text
connect Canva → open starter → edit design → save → Open in Canva → Canva opens a real design → return → Continue in Canva reopens same design → edit Command Center again → stale-copy choice appears → choose new copy → original Canva design remains untouched
```

Also verify Canva disconnected/import failure does not block editing, PNG export, PDF export, or autosave.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx artifacts/adventure-zone/src/lib/design-studio-api.ts artifacts/api-server/src/routes/office-design-studio.ts artifacts/adventure-zone/src/pages/DesignStudioCanvaAcceptance.test.tsx
git commit -m "test: finish Design Studio Canva handoff"
```
