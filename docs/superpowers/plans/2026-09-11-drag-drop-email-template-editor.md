# Drag-and-Drop Email Template Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-friendly visual email-template editor that can create and safely edit emails matching the current Adventure Zone branded HTML drafts.

**Architecture:** Store a versioned JSON block document beside the existing compiled `body_template`. Validate and compile documents on the API server into deterministic, email-safe HTML, while the React editor manages block composition, history, drag/reorder controls, settings, and preview. Legacy HTML imports conservatively into native blocks and lossless Custom HTML blocks; all existing render and Gmail draft consumers continue reading compiled HTML.

**Tech Stack:** React 19, TypeScript, `@dnd-kit/core`, `@dnd-kit/sortable`, Zod, Express, Drizzle/PostgreSQL, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-11-drag-drop-email-template-editor-design.md`

## Global Constraints

- The visual builder must be capable of reproducing the current 640px navy/pink/yellow/cream branded drafts, not merely plain newsletter layouts.
- Every operation available through dragging must also have practical touch-safe Up and Down buttons.
- Existing HTML must not change merely because a template was opened.
- Unrecognized legacy markup must be retained in Custom HTML blocks instead of discarded.
- `body_template` remains the authoritative payload for existing Gmail, preview, and render flows.
- Visual saves must atomically store both the editor document and server-compiled HTML.
- Saved output may not contain scripts, forms, frames, SVG, runtime JavaScript, or unsafe URL schemes.
- Existing placeholder names and `{{token}}` syntax remain authoritative.
- Direct image hosting is outside this feature; image fields accept URLs and known Adventure Zone assets.

---

## File Structure

### Shared document contract

- Create `lib/api-zod/src/email-template-builder.ts`: versioned block/document Zod schemas, inferred TypeScript types, limits, and reusable validators.
- Modify `lib/api-zod/src/index.ts`: export the builder contract.

### Persistence and API

- Create `lib/db/migrations/20260911_email_template_builder.sql`: nullable JSON document and integer version columns.
- Modify `lib/db/src/business-source-schema.ts`: Drizzle fields for the new columns.
- Modify `artifacts/api-server/src/db/lead-intake-required-startup.ts`: idempotent startup fallback for deployments that start before the normal migration runner.
- Modify `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`: expose document fields on records.
- Modify `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`: map and persist document fields.
- Create `artifacts/api-server/src/features/communication-templates/email-template-compiler.ts`: deterministic block-to-email HTML compiler and Custom HTML sanitizer.
- Modify `artifacts/api-server/src/routes/communication-templates.ts`: accept documents, compile server-side, and return document metadata.

### Visual editor

- Create `artifacts/adventure-zone/src/features/email-template-builder/email-builder-types.ts`: UI aliases, block labels, brand colors, known assets, and block factory functions.
- Create `artifacts/adventure-zone/src/features/email-template-builder/email-builder-history.ts`: pure undo/redo state transitions.
- Create `artifacts/adventure-zone/src/features/email-template-builder/legacy-email-import.ts`: conservative browser importer.
- Create `artifacts/adventure-zone/src/components/email-template-builder/EmailBuilder.tsx`: editor orchestration and responsive layout.
- Create `artifacts/adventure-zone/src/components/email-template-builder/BlockLibrary.tsx`: add/drag block palette.
- Create `artifacts/adventure-zone/src/components/email-template-builder/EmailCanvas.tsx`: sortable/selectable canvas and touch controls.
- Create `artifacts/adventure-zone/src/components/email-template-builder/BlockSettings.tsx`: typed controls for selected blocks and placeholders.
- Create `artifacts/adventure-zone/src/components/email-template-builder/EmailBuilderPreview.tsx`: sanitized iframe preview at desktop/mobile widths.
- Modify `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`: load, create, edit, save, and guard visual documents.

---

### Task 1: Define and persist the versioned builder document

**Files:**

- Create: `lib/api-zod/src/email-template-builder.ts`
- Modify: `lib/api-zod/src/index.ts`
- Create: `lib/db/migrations/20260911_email_template_builder.sql`
- Modify: `lib/db/src/business-source-schema.ts`
- Modify: `artifacts/api-server/src/db/lead-intake-required-startup.ts`
- Test: `lib/api-zod/src/email-template-builder.test.ts`
- Test: `artifacts/api-server/src/db/lead-intake-required-startup.test.ts`

**Interfaces:**

- Produces: `emailBuilderDocumentSchema`, `emailBuilderBlockSchema`, `EmailBuilderDocument`, `EmailBuilderBlock`, `EMAIL_BUILDER_DOCUMENT_VERSION`.
- Persists: `communicationTemplates.editorDocument: EmailBuilderDocument | null` and `communicationTemplates.editorDocumentVersion: number | null`.

- [ ] **Step 1: Write failing shared-schema tests**

Test a minimal version-1 document, all supported block discriminators, rejection above 100 blocks, invalid colors/URLs, invalid IDs, oversized text, and unknown block types. Use stable IDs such as `block-hero-1`; do not depend on random UUID generation in schema tests.

```ts
expect(emailBuilderDocumentSchema.parse({
  version: 1,
  settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
  blocks: [{ id: "block-text-1", type: "text", content: "Hi {{contactName}}", backgroundColor: "#f8f6f1", textColor: "#26324a", align: "left", padding: 32 }],
}).version).toBe(1);
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `pnpm --filter @workspace/api-zod exec vitest run src/email-template-builder.test.ts`

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement the discriminated block schemas**

Define blocks for `logoHeader`, `hero`, `text`, `image`, `videoThumbnail`, `packageCards`, `offerCallout`, `buttonRow`, `divider`, `spacer`, `signature`, `footer`, and `customHtml`. Keep common fields (`id`, `type`) in every variant; constrain colors to `^#[0-9a-fA-F]{6}$`, HTTP/mailto/tel destinations through an explicit safe URL validator, padding to `0..80`, and document block count to `1..100`.

- [ ] **Step 4: Add persistence migration and Drizzle fields**

```sql
ALTER TABLE communication_templates
  ADD COLUMN IF NOT EXISTS editor_document jsonb,
  ADD COLUMN IF NOT EXISTS editor_document_version integer;

ALTER TABLE communication_templates DROP CONSTRAINT IF EXISTS communication_templates_editor_document_shape;
ALTER TABLE communication_templates ADD CONSTRAINT communication_templates_editor_document_shape CHECK (
  (editor_document IS NULL AND editor_document_version IS NULL)
  OR (editor_document IS NOT NULL AND editor_document_version = 1)
);
```

Add the equivalent idempotent startup statements and extend its test so both new columns must be observed before startup succeeds.

- [ ] **Step 5: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @workspace/api-zod exec vitest run src/email-template-builder.test.ts
pnpm --filter @workspace/api-server exec vitest run src/db/lead-intake-required-startup.test.ts
pnpm run typecheck:libs
```

Expected: PASS.

- [ ] **Step 6: Commit the document contract and persistence**

```bash
git add lib/api-zod/src/email-template-builder.ts lib/api-zod/src/email-template-builder.test.ts lib/api-zod/src/index.ts lib/db/migrations/20260911_email_template_builder.sql lib/db/src/business-source-schema.ts artifacts/api-server/src/db/lead-intake-required-startup.ts artifacts/api-server/src/db/lead-intake-required-startup.test.ts
git commit -m "feat(email): add visual template document schema"
```

---

### Task 2: Compile blocks into email-safe Adventure Zone HTML

**Files:**

- Create: `artifacts/api-server/src/features/communication-templates/email-template-compiler.ts`
- Test: `artifacts/api-server/src/features/communication-templates/email-template-compiler.test.ts`

**Interfaces:**

- Consumes: `EmailBuilderDocument` from `@workspace/api-zod`.
- Produces: `compileEmailBuilderDocument(document: EmailBuilderDocument): string`.
- Produces: `sanitizeCustomEmailHtml(html: string): string`.

- [ ] **Step 1: Write failing compiler tests for every block**

Assert the 640px presentation-table shell, inline colors, responsive stacking CSS, escaped text, retained placeholder tokens, image alt text, website video destinations, one/two-button alignment, package-card columns, and branded footer. Add malicious Custom HTML cases for `<script>`, event attributes, `javascript:` URLs, forms, iframes, SVG, and CSS `url(javascript:...)`.

```ts
const html = compileEmailBuilderDocument(documentWith(heroBlock, packageCardsBlock, footerBlock));
expect(html).toContain('role="presentation"');
expect(html).toContain('width="640"');
expect(html).toContain("{{contactName}}");
expect(html).not.toMatch(/<script|javascript:|onclick=/i);
```

- [ ] **Step 2: Run compiler tests and verify they fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/email-template-compiler.test.ts`

Expected: FAIL because the compiler does not exist.

- [ ] **Step 3: Implement shared escaping and sanitization primitives**

Implement `escapeText`, `escapeAttribute`, `safeDestination`, and a strict server-side Custom HTML sanitizer. Preserve table-based email markup and inline styles needed by current drafts; remove forbidden elements/attributes and unsafe protocols. Do not mutate placeholder braces during escaping.

- [ ] **Step 4: Implement each block renderer and branded shell**

Each renderer returns one or more complete table rows. The shell adds preheader support, desktop width, responsive `.az-stack` and `.az-button` rules, background, and the standard `Arial,Helvetica,sans-serif` stack. Keep essential presentation inline because Gmail may strip head styles.

- [ ] **Step 5: Verify deterministic and safe output**

Run the focused compiler test twice and assert a snapshot produced from the full branded fixture is byte-identical on both calls.

Run: `pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/email-template-compiler.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the compiler**

```bash
git add artifacts/api-server/src/features/communication-templates/email-template-compiler.ts artifacts/api-server/src/features/communication-templates/email-template-compiler.test.ts
git commit -m "feat(email): compile branded builder blocks to HTML"
```

---

### Task 3: Make API saves atomic and backward compatible

**Files:**

- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`
- Modify: `artifacts/api-server/src/routes/communication-templates.ts`
- Test: `artifacts/api-server/src/routes/communication-templates.builder.test.ts`

**Interfaces:**

- Consumes: `emailBuilderDocumentSchema` and `compileEmailBuilderDocument`.
- API input: optional `editorDocument`; clients never submit trusted compiled HTML when this field is present.
- API output: `editorDocument` and `editorDocumentVersion` beside existing template fields.

- [ ] **Step 1: Write failing route tests**

Cover visual create, visual patch, legacy HTML-only patch, invalid document, compiler rejection, and active-template transition to `reviewed`. For a visual save, assert the inserted/updated row receives server output rather than a client-supplied fake `bodyTemplate`.

```ts
expect(saved.bodyFormat).toBe("html");
expect(saved.editorDocumentVersion).toBe(1);
expect(saved.bodyTemplate).toContain("LET’S BRING THE FUN");
expect(saved.bodyTemplate).not.toContain("CLIENT FORGERY");
```

- [ ] **Step 2: Run the route test and verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.builder.test.ts`

Expected: FAIL because the route does not accept `editorDocument`.

- [ ] **Step 3: Extend record mapping and write schemas**

Add nullable document fields to `CommunicationTemplateRecord` and `mapTemplate`. Extend create/patch Zod schemas with optional `editorDocument`. When present, parse it, compile it, force `bodyFormat: "html"`, compute allowed placeholders from subject plus compiled body, and set both persisted representations in one insert/update.

- [ ] **Step 4: Preserve legacy clients and review behavior**

When `editorDocument` is absent, retain current `bodyTemplate` and `bodyFormat` handling exactly. Continue moving edited active templates to `reviewed`. Do not change the fingerprint, Gmail, preview, or approval services; they continue consuming stored HTML.

- [ ] **Step 5: Run API tests and typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.builder.test.ts src/features/communication-templates/email-template-compiler.test.ts
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit API integration**

```bash
git add artifacts/api-server/src/features/communication-templates/communication-template-types.ts artifacts/api-server/src/features/communication-templates/communication-template-repository.ts artifacts/api-server/src/routes/communication-templates.ts artifacts/api-server/src/routes/communication-templates.builder.test.ts
git commit -m "feat(email): save builder documents with compiled HTML"
```

---

### Task 4: Build block factories, history, and conservative legacy import

**Files:**

- Create: `artifacts/adventure-zone/src/features/email-template-builder/email-builder-types.ts`
- Create: `artifacts/adventure-zone/src/features/email-template-builder/email-builder-history.ts`
- Create: `artifacts/adventure-zone/src/features/email-template-builder/legacy-email-import.ts`
- Test: `artifacts/adventure-zone/src/features/email-template-builder/email-builder-history.test.ts`
- Test: `artifacts/adventure-zone/src/features/email-template-builder/legacy-email-import.test.ts`

**Interfaces:**

- Produces: `createEmailBlock(type): EmailBuilderBlock`, `createBrandedStarterDocument(): EmailBuilderDocument`.
- Produces: `builderReducer(state, action): EmailBuilderHistoryState` with `present`, `past`, and `future`.
- Produces: `importLegacyEmail(html: string): { document: EmailBuilderDocument; fullyNative: boolean }`.

- [ ] **Step 1: Write failing history tests**

Test add, update, reorder, duplicate with a new ID, delete, undo, redo, redo invalidation after a new edit, and history capped at 50 snapshots.

- [ ] **Step 2: Write failing importer tests with real branded fixtures**

Use trimmed fixtures shaped like the current convention drafts: logo header, navy hero, cream text, three package cards, pink offer, buttons, and footer. Assert recognized rows become native blocks and an unfamiliar nested table becomes one unchanged `customHtml` block. Assert an empty or malformed input still yields a valid Custom HTML document without throwing.

- [ ] **Step 3: Run the feature tests and verify they fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/features/email-template-builder`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement brand metadata and factories**

Use exact presets `#0f1729`, `#ff0a8a`, `#ffca05`, `#f8f6f1`, `#ffffff`, and `#26324a`. Include the current hosted logo and known package/video image URLs. The starter document must include logo header, hero, text, image/video area, package cards, offer callout, button row, signature, and footer.

- [ ] **Step 5: Implement immutable history and conservative import**

Recognition must require stable structural/color/content signals; if a structure is ambiguous, preserve its outer HTML in `customHtml`. Importing never writes to the server and never changes the original template until Save.

- [ ] **Step 6: Run feature tests and typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/email-template-builder
pnpm --filter @workspace/adventure-zone run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit editor state primitives**

```bash
git add artifacts/adventure-zone/src/features/email-template-builder
git commit -m "feat(email): add builder state and legacy import"
```

---

### Task 5: Build the responsive block editor UI

**Files:**

- Create: `artifacts/adventure-zone/src/components/email-template-builder/BlockLibrary.tsx`
- Create: `artifacts/adventure-zone/src/components/email-template-builder/EmailCanvas.tsx`
- Create: `artifacts/adventure-zone/src/components/email-template-builder/BlockSettings.tsx`
- Create: `artifacts/adventure-zone/src/components/email-template-builder/EmailBuilderPreview.tsx`
- Create: `artifacts/adventure-zone/src/components/email-template-builder/EmailBuilder.tsx`
- Test: `artifacts/adventure-zone/src/components/email-template-builder/EmailBuilder.test.tsx`

**Interfaces:**

- Produces: `<EmailBuilder value onChange subject onSubjectChange previewHtml onPreviewRequest />`.
- Consumes: block factories, history reducer, DnD Kit, placeholder list, and server preview result.

- [ ] **Step 1: Write failing user-flow component tests**

Test adding a Hero, selecting and editing its headline, moving it with both drag completion and Move Up, duplicating, deleting, undoing, redoing, inserting `{{eventName}}`, switching Desktop/Mobile preview, editing Custom HTML, and opening whole-email Advanced HTML. Use accessible role/name queries rather than CSS selectors.

- [ ] **Step 2: Run the component test and verify it fails**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/email-template-builder/EmailBuilder.test.tsx`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the block library and canvas**

Use `DndContext`, `SortableContext`, keyboard coordinates, pointer and keyboard sensors. Canvas block controls must have `Move up`, `Move down`, `Duplicate`, and `Delete` accessible names and minimum 44px touch targets. Render a compact visual approximation; use the compiled iframe for authoritative preview.

- [ ] **Step 4: Implement typed block settings**

Provide only relevant controls for the selected block: text, URLs, alt text, alignment, colors, spacing, cards, and button data. Add Adventure Zone preset swatches plus native color inputs. Insert placeholders at the focused text control when possible, falling back to appending.

- [ ] **Step 5: Implement preview and advanced HTML controls**

Render compiled server preview in a sandboxed iframe. Desktop uses a 700px viewport wrapper and Mobile uses 390px. Custom HTML is edited per selected block. Whole-email source changes call the importer and show a confirmation explaining that unsupported areas will become Custom HTML blocks.

- [ ] **Step 6: Implement history and unsaved-state callbacks**

Connect all document mutations through the reducer. Disable impossible Undo/Redo and Move actions. Expose a dirty-state callback or deterministic equality helper for the page guard.

- [ ] **Step 7: Run component tests and accessibility checks**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/email-template-builder/EmailBuilder.test.tsx
pnpm --filter @workspace/adventure-zone run typecheck
```

Expected: PASS with no act warnings or inaccessible unnamed controls.

- [ ] **Step 8: Commit the editor UI**

```bash
git add artifacts/adventure-zone/src/components/email-template-builder
git commit -m "feat(email): add responsive drag-and-drop editor"
```

---

### Task 6: Integrate visual create/edit/save into Communication Templates

**Files:**

- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.builder.test.tsx`

**Interfaces:**

- Consumes: `EmailBuilder`, `createBrandedStarterDocument`, `importLegacyEmail`.
- Calls: existing `POST /communication-templates` and `PATCH /communication-templates/:id` with `editorDocument`.
- Calls: existing preview endpoint after server compilation or uses the returned compiled HTML from save/preview response.

- [ ] **Step 1: Write failing page integration tests**

Test New Template offering `Adventure Zone branded` and `Blank`, opening a legacy HTML template without a write request, saving an imported template, reopening a stored editor document, subject placeholder insertion, dirty-state confirmation on template switch, API error retention, the absence of the retired Send to Dave action, and the unchanged Archive action.

- [ ] **Step 2: Run the page test and verify it fails**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SettingsCommunicationTemplatesPage.builder.test.tsx`

Expected: FAIL because the page still renders textareas.

- [ ] **Step 3: Replace body textareas with the visual editor**

Keep the template sidebar and subject field. For stored documents, initialize directly; for legacy HTML, call the importer locally while retaining the untouched source until Save. Plain-text templates may remain in a simple text mode with an explicit `Convert to visual email` action.

- [ ] **Step 4: Integrate visual creation and saving**

New branded templates start with the complete Adventure Zone layout and `bodyFormat: "html"`; blank visual templates start with one Text block. Submit `editorDocument`, never client-trusted compiled HTML, and update local state from the saved API response.

- [ ] **Step 5: Add save states and navigation protection**

Show `Unsaved changes`, `Saving…`, `Saved`, and clear failure text. Confirm before selecting another template, starting a new one, or navigating away when dirty. A failed save must keep the current document and history.

- [ ] **Step 6: Run page tests and complete frontend verification**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SettingsCommunicationTemplatesPage.builder.test.tsx src/components/email-template-builder/EmailBuilder.test.tsx src/features/email-template-builder
pnpm --filter @workspace/adventure-zone run typecheck
pnpm --filter @workspace/adventure-zone run build
```

Expected: PASS.

- [ ] **Step 7: Commit page integration**

```bash
git add artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.builder.test.tsx
git commit -m "feat(email): integrate visual template builder"
```

---

### Task 7: Prove branded output and protect downstream workflows

**Files:**

- Create: `artifacts/api-server/src/features/communication-templates/email-template-builder-acceptance.test.ts`
- Modify only if a regression is found: existing preview/render/Gmail/approval tests and their directly responsible implementation.

**Interfaces:**

- Consumes: full branded starter document and `compileEmailBuilderDocument`.
- Verifies: existing `renderCommunicationTemplateText`, Gmail draft generation, and `templateFingerprint` behavior against compiled HTML.

- [ ] **Step 1: Add the full branded acceptance fixture**

Construct an email with every branded structure used in current drafts: logo, navy hero with pink/yellow accents, personalized cream body, linked video thumbnail, three package cards, offer callout, centered buttons, signature, and navy footer.

- [ ] **Step 2: Assert quality and compatibility invariants**

Assert exact brand colors, responsive classes, accessible alt text, safe links, all placeholders, no forbidden markup, body width, package-card stacking, centered bottom website button, and non-blue footer link styling. Pass the compiled result through the current renderer and approval fingerprint.

- [ ] **Step 3: Run all affected backend and frontend tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates src/routes/communication-templates.builder.test.ts src/features/boss-work-requests
pnpm --filter @workspace/adventure-zone exec vitest run src/features/email-template-builder src/components/email-template-builder src/pages/SettingsCommunicationTemplatesPage.builder.test.tsx
pnpm run typecheck
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: PASS.

- [ ] **Step 4: Run repository diff and migration safety checks**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -8
```

Verify only planned feature files and documentation are present, the migration is additive/idempotent, and no generated secrets or build artifacts are tracked.

- [ ] **Step 5: Commit acceptance coverage**

```bash
git add artifacts/api-server/src/features/communication-templates/email-template-builder-acceptance.test.ts
git commit -m "test(email): verify branded builder compatibility"
```

- [ ] **Step 6: Record final verification evidence**

Update this plan's checkboxes as tasks finish and record the exact passing command summaries in the handoff. Do not claim the editor is ready until the test, typecheck, and both build commands have freshly passed.

## Verification record — 2026-09-12

- Shared builder schema: 1 file, 6 tests passed.
- Frontend builder/history/import/page: 4 files, 15 tests passed.
- API communication-template and startup coverage: 6 files, 20 tests passed.
- Focused TypeScript diagnostics for every changed feature path: no errors.
- Adventure Zone Vite production build: passed (2,555 modules transformed).
- API server esbuild production build: passed.
- Repository-wide typecheck remains blocked by the separately approved pre-existing booking, Design Studio, generated-output, and missing-workspace-dependency errors; no diagnostic targets an email-builder file.
- Manual review findings addressed: placeholder HTML injection, protocol allowlisting, responsive CSS retention, stale legacy API documents, full-shell and per-row legacy preservation, explicit plain-text conversion, constrained rich text, anchored mobile controls, new-draft guards, drop-position insertion, and editable card/button collections.
