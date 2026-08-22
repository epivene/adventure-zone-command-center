# Business Drive Integration Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Execute the four detailed plans below in this order; do not run them in parallel because they intentionally touch shared DB schema, resource settings, profiles, and settings navigation.

**Goal:** Safely integrate the approved Adventure Zone business-drive source set into Command Center as polished sales/office guidance, accurate package knowledge, Leg Manager pre/post-event checklists, reviewed inventory/history data, and protected historical event documents.

**Approved spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

**User approval:** 2026-08-22.

## Detailed plans and order

1. `docs/superpowers/plans/2026-08-22-business-drive-copy-and-knowledge.md`
   - Creates the source/provenance foundation used by later phases.
   - Refreshes reviewed 2026 package defaults.
   - Adds polished communication templates and selective call-script branches.
   - Integrates Active templates into the Office Coordinator draft workflow without send permission.

2. `docs/superpowers/plans/2026-08-22-leg-event-pre-post-checklists.md`
   - Extends the existing Leg Manager lifecycle with pre-event and post-event checklists.
   - Adds resource applicability tags, unsafe-resource status handling, photos, offline persistence, and owner overrides.
   - Keeps check-in arrival durable before checklist work and final checkout behind the post-event checklist/exception.

3. `docs/superpowers/plans/2026-08-22-inventory-and-attended-history.md`
   - Adds year/make/model/serial identity to resources and stages the nine known inflatables for conservative matching.
   - Converts the attended-calendar workbook to a committed normalized fixture using artifact_tool.
   - Requires owner review before uncertain attendance rows attach to profiles/locations.
   - Keeps blacklist history owner-sensitive and separate from Do Not Call.

4. `docs/superpowers/plans/2026-08-22-event-source-documents.md`
   - Adds protected binary storage and profile/booking/location links for historical source files.
   - Stores Ravalli/Hawthorne terms as event-specific historical facts only.
   - Adds owner-only upload/open/review UI and a post-deploy upload/link runbook.

## Cross-plan rules

- Each detailed plan is authoritative for its subsystem. If an implementation discovery conflicts with the approved product behavior, stop and update the plan/spec rather than improvising a user-visible behavior change.
- Use a new migration for every later schema addition; never edit a migration that has already been applied by an earlier task.
- Preserve existing owner edits. Source seeds may upgrade known old defaults only when the stored value is still the old seed value.
- Never commit the private Ravalli contract or Hawthorne vendor application binary to GitHub.
- Never expose EIN, sales-tax identifiers, private reference contacts, signatures, discretionary discount rules, source conflicts, or owner-only legal documents through Office or Leg Manager APIs.
- Never activate raw Amy wording. Active scripts/templates must contain edited copy with correct grammar, spelling, punctuation, capitalization, package names, and supported claims.
- Never replace the current preferred call opener/details wording merely because similar older wording exists in the source document.
- Never promise no-upfront-cost/payment arrangements until eligibility is confirmed.
- Never let an event-specific contract overwrite package defaults.
- Never auto-create a profile from an attendance row or auto-merge repeated event occurrences on fuzzy similarity alone.
- Never automatically translate an attended-calendar `B` into Do Not Call.
- Never allow an unsafe checklist result to disappear because photo upload or condition-follow-up sync failed.

## Phase gates

### Gate 1 — Copy/knowledge foundation

Before starting the checklist phase:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources artifacts/api-server/src/features/communication-templates artifacts/api-server/src/features/packages
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/features/calls/guided-call-scripts.test.ts artifacts/adventure-zone/src/pages/OfficeWorkspace.test.tsx
pnpm run typecheck
```

Confirm:
- Adventure Zone $9,000, Pirate's Rebellion $7,500, Warrior's Playground $7,500, Mini Zone $5,000 are editable reviewed starting defaults.
- Mini Zone 44-vs-50 barrel conflict remains visible to owner and is not silently quoted.
- Office can render/edit/submit an Active template but cannot send.
- Current preferred call wording remains unless a reviewed branch explicitly extends it.

### Gate 2 — Event checklist lifecycle

Before inventory/history work:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/leg-manager/event-checklist-schema.test.ts artifacts/api-server/src/features/leg-manager/event-checklist-seed.test.ts artifacts/api-server/src/features/leg-manager/event-checklist-service.test.ts artifacts/api-server/src/features/leg-manager/resource-condition-service.test.ts artifacts/api-server/src/routes/leg-manager-event-lifecycle.test.ts artifacts/api-server/src/routes/leg-manager-event-checklists.test.ts artifacts/api-server/src/routes/leg-manager-event-checklist-attachments.test.ts artifacts/api-server/src/routes/leg-manager-event-checklists-admin.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/components/manager/event-lifecycle-action.test.tsx artifacts/adventure-zone/src/components/manager/event-checklist-form.test.tsx artifacts/adventure-zone/src/components/manager/checklist-photo-capture.test.tsx artifacts/adventure-zone/src/pages/ManagerHomePage.test.tsx
pnpm run typecheck
```

Confirm the exact state chain:

```text
Confirmed -> Check in -> arrival saved -> pre-event checklist -> Ready to operate
-> Start checkout -> post-event checklist -> final checkout -> existing event wrap-up
```

### Gate 3 — Inventory/history

Before event-source document work:

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/resources/resource-asset-identity.test.ts artifacts/api-server/src/features/resources/resource-source-candidate-seed.test.ts artifacts/api-server/src/features/attendance/event-attendance-schema.test.ts artifacts/api-server/src/features/attendance/attendance-source-fixture.test.ts artifacts/api-server/src/features/attendance/attendance-import-seed.test.ts artifacts/api-server/src/features/attendance/attendance-matcher.test.ts artifacts/api-server/src/routes/resource-source-candidates.test.ts artifacts/api-server/src/routes/attendance-history-import.test.ts
pnpm run typecheck
```

Confirm the normalized attendance fixture still contains exactly:

```text
107 event/month source rows
193 year-status entries
184 attended
1 blacklisted
8 cancelled_last_minute
```

### Gate 4 — Protected historical documents

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/event-source-document-schema.test.ts artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts artifacts/api-server/src/routes/business-source-document-files.test.ts artifacts/api-server/src/routes/business-source-document-links.test.ts artifacts/api-server/src/routes/event-profiles.source-documents.test.ts artifacts/api-server/src/routes/office-profiles.source-documents.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-source-documents.test.tsx
pnpm run typecheck
```

Confirm:
- Private file opens are owner-authorized and use short-lived signed URLs only.
- Ravalli's $6,300 negotiated 2025 term exists only as historical event data.
- Hawthorne's April 25, 2026 deadline remains historical and creates no overdue task.
- Hawthorne form booth sizes are never used as package setup dimensions.

## Final integrated verification

After all four plans are complete:

```bash
pnpm run typecheck
pnpm --filter @workspace/api-server exec vitest run
pnpm --filter @workspace/adventure-zone exec vitest run
```

Then run the repository's existing build command from `package.json` and verify the built app manually in these flows:

```text
Owner: package/template/source settings -> profile history/documents -> checklist oversight
Office Coordinator: profile -> choose template -> edit -> Submit Email -> no Send action
Leg Manager: check in -> pre checklist -> operate -> post checklist -> checkout -> wrap-up
Owner Imports/Data: attendance review -> approve match -> profile attendance history
Owner Packages/Resources: imported asset candidate -> link -> asset identity fields
```

Finally verify no private uploaded business binary is tracked:

```bash
git ls-files | rg -i "pirates rebellion contract|vendor app 2026" && exit 1 || true
```

Commit only tracked verification fixes:

```bash
git add -u
git diff --cached --quiet || git commit -m "test: verify business drive integration"
```
