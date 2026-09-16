# Year-End Leg Inspections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first annual leg inspection system that tracks reusable inflatable components, notes, annotated photos, repair follow-up, and complete historical records for managers, admin, and boss users.

**Architecture:** Add a focused year-end-inspection schema alongside the existing resource and travel-leg schemas. Expose leg-scoped manager services and company-wide admin/boss services over the existing authentication, offline mutation queue, private object storage, and maintenance dashboard patterns; keep original inspection evidence immutable while projecting repair findings into separate maintenance items.

**Tech Stack:** PostgreSQL, Drizzle ORM, Express 5, Zod, React 19, Wouter, IndexedDB, Google Cloud private object storage, Vitest, Testing Library, PGlite, TypeScript 5.9.

**Spec:** `docs/superpowers/specs/2026-09-16-year-end-leg-inspections-design.md`

## Global Constraints

- The equipment count is unlimited; never encode the current estimate of 58 in validation, queries, or interface layout.
- A piece is an individual physical component and may be grouped into a whole attraction, stored as a spare, or temporarily have no parent attraction.
- Each leg owns a separate yearly inspection list; a prior year may be copied forward.
- The original photo is private and unchanged; optional circle annotations are stored as normalized coordinates and the description renders beneath the photo.
- The leg manager edits only their assigned leg. Admin and boss users can review every leg, reopen records, transfer/regroup pieces, and manage repair follow-up.
- Inspection findings remain historical evidence. Repair resolution never overwrites the original condition.
- Manager writes and photo creation are idempotent and safe to retry from the existing offline queues.
- Existing resource, maintenance, checklist, leg, and photo data must not be rewritten.

## File and Boundary Map

- `lib/db/src/year-end-inspection-schema.ts`: Drizzle tables and shared value types only.
- `artifacts/api-server/src/db/year-end-inspection-required-startup.ts`: idempotent production schema readiness only.
- `artifacts/api-server/src/features/year-end-inspections/piece-repository.ts`: piece CRUD, active composition, assignment history, transfer/archive operations.
- `artifacts/api-server/src/features/year-end-inspections/inspection-repository.ts`: inspection, entry, photo metadata, and audit persistence.
- `artifacts/api-server/src/features/year-end-inspections/inspection-service.ts`: copy/start/complete/reopen rules and progress calculations.
- `artifacts/api-server/src/features/year-end-inspections/maintenance-projection.ts`: idempotent attention-item creation and repair resolution.
- `artifacts/api-server/src/features/year-end-inspections/photo-service.ts`: image validation, private object keys, upload/read/delete behavior.
- `artifacts/api-server/src/routes/manager-year-end-inspections.ts`: manager-leg-scoped endpoints.
- `artifacts/api-server/src/routes/admin-year-end-inspections.ts`: owner/admin operations.
- `artifacts/api-server/src/routes/boss-year-end-inspections.ts`: boss review operations using existing boss auth.
- `artifacts/adventure-zone/src/lib/year-end-inspections-api.ts`: browser DTOs and admin/boss API wrappers.
- `artifacts/adventure-zone/src/lib/inspection-photo-annotations.ts`: normalized annotation math with no React dependency.
- `artifacts/adventure-zone/src/components/manager/inspection-photo-editor.tsx`: capture, draw, describe, and offline queue interaction.
- `artifacts/adventure-zone/src/pages/ManagerYearEndInspectionPage.tsx`: manager list, progress, entry editor, and completion flow.
- `artifacts/adventure-zone/src/components/year-end-inspections/inspection-record-view.tsx`: shared read/review view for admin and boss.
- `artifacts/adventure-zone/src/pages/YearEndInspectionsAdminPage.tsx`: company-wide inventory and inspection controls.
- `artifacts/adventure-zone/src/pages/BossMaintenancePage.tsx`: maintenance list integration and linked detail rendering.

---

### Task 1: Persist reusable pieces and annual inspections

**Files:**
- Create: `lib/db/migrations/20260916_year_end_leg_inspections.sql`
- Create: `lib/db/src/year-end-inspection-schema.ts`
- Modify: `lib/db/package.json`
- Create: `artifacts/api-server/src/db/year-end-inspection-required-startup.ts`
- Create: `artifacts/api-server/src/db/year-end-inspection-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`

**Interfaces:**
- Produces: `equipmentPieces`, `equipmentPieceAssignments`, `yearEndLegInspections`, `yearEndInspectionEntries`, `yearEndInspectionPhotos`, `yearEndInspectionMaintenanceItems`, and `yearEndInspectionAuditEvents` Drizzle tables.
- Produces: `PieceLifecycleStatus`, `InspectionStatus`, `InspectionEntryState`, `PieceCondition`, `PhotoAnnotationDocument`, and exported value arrays for Zod validation.
- Produces: `ensureYearEndInspectionSchemaBeforeListen(options?): Promise<boolean>`.

- [ ] **Step 1: Write the failing startup-schema test**

```ts
it("creates all annual inspection tables", async () => {
  const queries: string[] = [];
  expect(await ensureYearEndInspectionSchemaBeforeListen({ pool: fakePool(queries) })).toBe(true);
  const sql = queries.join(" ");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS equipment_pieces");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS equipment_piece_assignments");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS year_end_leg_inspections");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_entries");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_photos");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_maintenance_items");
  expect(sql).toContain("CREATE TABLE IF NOT EXISTS year_end_inspection_audit_events");
});
```

- [ ] **Step 2: Run the focused test and verify the missing module failure**

Run: `pnpm --filter @workspace/api-server test -- src/db/year-end-inspection-required-startup.test.ts`

Expected: FAIL because `year-end-inspection-required-startup.ts` does not exist.

- [ ] **Step 3: Add the SQL migration and matching Drizzle schema**

Use these identities and constraints in both the migration and startup SQL:

```sql
CREATE TABLE IF NOT EXISTS equipment_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  piece_type text NOT NULL DEFAULT 'inflatable_component',
  current_leg_id uuid REFERENCES travel_legs(id) ON DELETE RESTRICT,
  storage_location text,
  identity_notes text,
  lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','stored_spare','needs_repair','replace','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_pieces_active_code_unique
  ON equipment_pieces(lower(code)) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS equipment_piece_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id uuid NOT NULL REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  actor_id text NOT NULL,
  reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS equipment_piece_assignments_active_piece_unique
  ON equipment_piece_assignments(piece_id) WHERE removed_at IS NULL;
```

Define the remaining tables with these evidence-preserving columns and constraints:

```sql
CREATE TABLE IF NOT EXISTS year_end_leg_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL UNIQUE,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
  inspection_year integer NOT NULL CHECK (inspection_year BETWEEN 2000 AND 2200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','completed')),
  copied_from_inspection_id uuid REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  manager_identity_snapshot text,
  overall_notes text,
  admin_follow_up_note text,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS year_end_leg_inspections_active_leg_year_unique
  ON year_end_leg_inspections(leg_id, inspection_year) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS year_end_inspection_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL UNIQUE,
  inspection_id uuid NOT NULL REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  piece_id uuid NOT NULL REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  piece_code_snapshot text NOT NULL,
  piece_name_snapshot text NOT NULL,
  resource_id_snapshot uuid REFERENCES resources(id) ON DELETE SET NULL,
  resource_name_snapshot text,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  entry_state text NOT NULL DEFAULT 'not_started' CHECK (entry_state IN ('not_started','inspected','not_present')),
  condition text CHECK (condition IS NULL OR condition IN ('good','needs_cleaning','minor_repair','major_repair','replace','retired')),
  inspection_notes text,
  repair_needed boolean NOT NULL DEFAULT false,
  repair_notes text,
  retain_for_future_use boolean NOT NULL DEFAULT true,
  inspected_at timestamptz,
  inspector_identity_snapshot text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, piece_id)
);

CREATE TABLE IF NOT EXISTS year_end_inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL UNIQUE,
  entry_id uuid NOT NULL REFERENCES year_end_inspection_entries(id) ON DELETE RESTRICT,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
  object_key text,
  upload_status text NOT NULL DEFAULT 'image_pending' CHECK (upload_status IN ('image_pending','image_uploaded','image_failed')),
  mime_type text NOT NULL,
  description text,
  annotations jsonb NOT NULL DEFAULT '{"version":1,"ellipses":[]}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS year_end_inspection_maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL UNIQUE REFERENCES year_end_inspection_entries(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  follow_up_notes text,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  resolved_at timestamptz,
  resolved_by text
);

CREATE TABLE IF NOT EXISTS year_end_inspection_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid REFERENCES year_end_leg_inspections(id) ON DELETE RESTRICT,
  piece_id uuid REFERENCES equipment_pieces(id) ON DELETE RESTRICT,
  action text NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inspection_id IS NOT NULL OR piece_id IS NOT NULL)
);
```

In `year-end-inspection-schema.ts`, export exact values:

```ts
export const pieceLifecycleStatusValues = ["active", "stored_spare", "needs_repair", "replace", "retired"] as const;
export const yearEndInspectionStatusValues = ["draft", "in_progress", "completed"] as const;
export const yearEndInspectionEntryStateValues = ["not_started", "inspected", "not_present"] as const;
export const pieceConditionValues = ["good", "needs_cleaning", "minor_repair", "major_repair", "replace", "retired"] as const;
export type PhotoEllipse = { id: string; x: number; y: number; radiusX: number; radiusY: number };
export type PhotoAnnotationDocument = { version: 1; ellipses: PhotoEllipse[] };
```

Export the module from `lib/db/package.json` as `./year-end-inspection-schema`.

- [ ] **Step 4: Register the required startup step**

Add `ensureYearEndInspectionSchemaBeforeListen` to `runRequiredSchemaStartup()` under the label `year-end-inspection-schema` and update the orchestration test to assert that label runs exactly once.

- [ ] **Step 5: Run schema tests and library typechecking**

Run: `pnpm --filter @workspace/api-server test -- src/db/year-end-inspection-required-startup.test.ts src/db/required-schema-startup.test.ts && pnpm --filter @workspace/db build`

Expected: all selected tests PASS and the DB package builds without type errors.

- [ ] **Step 6: Commit the schema slice**

```bash
git add lib/db/migrations/20260916_year_end_leg_inspections.sql lib/db/src/year-end-inspection-schema.ts lib/db/package.json artifacts/api-server/src/db/year-end-inspection-required-startup.ts artifacts/api-server/src/db/year-end-inspection-required-startup.test.ts artifacts/api-server/src/db/required-schema-startup.ts artifacts/api-server/src/db/required-schema-startup.test.ts
git commit -m "feat(inspections): add annual leg inspection schema"
```

---

### Task 2: Implement reusable-piece inventory and composition history

**Files:**
- Create: `artifacts/api-server/src/features/year-end-inspections/piece-types.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/piece-input.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/piece-repository.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/piece-repository.pglite.test.ts`

**Interfaces:**
- Consumes: Task 1 Drizzle tables and shared value arrays.
- Produces: `pieceInputSchema`, `piecePatchSchema`, `PieceInventoryRecord`, and `DrizzlePieceRepository`.
- Produces methods: `list(filters)`, `get(id)`, `create(input, actor)`, `update(id, input, actor)`, `assignToResource(id, resourceId, actor, reason)`, `clearResourceAssignment(id, actor, reason)`, `transferLeg(id, legId, actor)`, `archive(id, actor)`, and `restore(id, actor)`.

- [ ] **Step 1: Write PGlite tests for unlimited records, unique active codes, regrouping, transfer, and history**

```ts
it("keeps composition history when a piece is regrouped", async () => {
  const piece = await repository.create(pieceInput({ code: "AZ-017" }), "owner:1");
  await repository.assignToResource(piece.id, firstAttractionId, "owner:1", "initial build");
  await repository.assignToResource(piece.id, secondAttractionId, "owner:1", "2027 regrouping");
  const result = await repository.get(piece.id);
  expect(result?.currentResourceId).toBe(secondAttractionId);
  expect(result?.assignmentHistory).toMatchObject([
    { resourceId: firstAttractionId, removedAt: expect.any(Date) },
    { resourceId: secondAttractionId, removedAt: null },
  ]);
});

it("does not impose a 58-piece limit", async () => {
  for (let index = 1; index <= 60; index += 1) {
    await repository.create(pieceInput({ code: `P-${index}` }), "owner:1");
  }
  expect(await repository.list({})).toHaveLength(60);
});
```

- [ ] **Step 2: Run the repository tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/piece-repository.pglite.test.ts`

Expected: FAIL because the repository is missing.

- [ ] **Step 3: Implement Zod inputs and transactional repository methods**

```ts
export const pieceInputSchema = z.object({
  clientMutationId: z.string().uuid().optional(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  pieceType: z.string().trim().min(1).max(120).default("inflatable_component"),
  currentLegId: z.string().uuid().nullable(),
  storageLocation: z.string().trim().max(500).nullable().default(null),
  identityNotes: z.string().trim().max(12000).nullable().default(null),
  lifecycleStatus: z.enum(pieceLifecycleStatusValues).default("active"),
  resourceId: z.string().uuid().nullable().default(null),
});
```

Use a database transaction to close the current `equipment_piece_assignments` row before inserting the new active row. Reject archived legs/resources and record audit rows for transfer, regroup, archive, and restore.

- [ ] **Step 4: Run the piece tests and API-server typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/piece-repository.pglite.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the inventory domain**

```bash
git add artifacts/api-server/src/features/year-end-inspections/piece-*.ts
git commit -m "feat(inspections): track reusable inflatable pieces"
```

---

### Task 3: Implement annual inspection lifecycle and maintenance projection

**Files:**
- Create: `artifacts/api-server/src/features/year-end-inspections/inspection-types.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/inspection-repository.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/inspection-service.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/maintenance-projection.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/inspection-service.pglite.test.ts`

**Interfaces:**
- Consumes: Task 1 tables and Task 2 `DrizzlePieceRepository` records.
- Produces: `InspectionDetail`, `InspectionProgress`, `InspectionEntryPatch`, and `YearEndInspectionService`.
- Produces methods: `startForCurrentPieces`, `startBlank`, `copyPriorYear`, `getForLegYear`, `patchEntry`, `complete`, `reopen`, `addPieceToInspection`, and `progress`.
- Produces: `syncMaintenanceItemForEntry(entryId, actorId): Promise<void>` and `resolveMaintenanceItem(itemId, input, actorId)`.

- [ ] **Step 1: Write lifecycle tests**

```ts
it("copies prior-year entries as independent snapshots", async () => {
  const prior = await service.startForCurrentPieces({ legId, year: 2026, clientMutationId: crypto.randomUUID(), actor });
  await service.patchEntry(prior.entries[0]!.id, { entryState: "inspected", condition: "minor_repair", inspectionNotes: "Seam wear" }, actor);
  const next = await service.copyPriorYear({ legId, year: 2027, sourceInspectionId: prior.id, clientMutationId: crypto.randomUUID(), actor });
  expect(next.entries[0]).toMatchObject({ entryState: "not_started", pieceNameSnapshot: prior.entries[0]!.pieceNameSnapshot });
  expect(next.entries[0]!.id).not.toBe(prior.entries[0]!.id);
});

it("blocks completion until every entry is resolved", async () => {
  const inspection = await service.startForCurrentPieces({ legId, year: 2026, clientMutationId: crypto.randomUUID(), actor });
  await expect(service.complete(inspection.id, actor)).rejects.toMatchObject({ code: "inspection_incomplete" });
});

it("creates one maintenance item without overwriting evidence", async () => {
  await service.patchEntry(entryId, { entryState: "inspected", condition: "major_repair", inspectionNotes: "Anchor panel tear", repairNeeded: true, repairNotes: "Patch before storage" }, actor);
  await service.patchEntry(entryId, { inspectionNotes: "Anchor panel tear photographed" }, actor);
  expect(await maintenanceItemsFor(entryId)).toHaveLength(1);
  expect((await repository.getEntry(entryId))?.condition).toBe("major_repair");
});
```

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/inspection-service.pglite.test.ts`

Expected: FAIL because inspection services are missing.

- [ ] **Step 3: Implement snapshot creation, progress, completion, reopen, and projection rules**

```ts
export type InspectionProgress = {
  total: number;
  notStarted: number;
  inspected: number;
  notPresent: number;
  needsAttention: number;
  percentComplete: number;
};

export function calculateInspectionProgress(entries: InspectionEntryRecord[]): InspectionProgress {
  const inspected = entries.filter(row => row.entryState === "inspected").length;
  const notPresent = entries.filter(row => row.entryState === "not_present").length;
  const total = entries.length;
  return {
    total,
    inspected,
    notPresent,
    notStarted: total - inspected - notPresent,
    needsAttention: entries.filter(row => ["minor_repair", "major_repair", "replace", "retired"].includes(row.condition ?? "")).length,
    percentComplete: total === 0 ? 0 : Math.round(((inspected + notPresent) / total) * 100),
  };
}
```

Require a nonblank photo description at completion when a repair/replace entry has photos. `reopen()` adds an audit row and clears `completed_at`; it does not delete entries or maintenance items.

- [ ] **Step 4: Run lifecycle tests and typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/inspection-service.pglite.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the inspection domain**

```bash
git add artifacts/api-server/src/features/year-end-inspections/inspection-*.ts artifacts/api-server/src/features/year-end-inspections/maintenance-projection.ts
git commit -m "feat(inspections): add annual inspection lifecycle"
```

---

### Task 4: Add secure photo metadata, annotations, and private uploads

**Files:**
- Create: `artifacts/api-server/src/features/year-end-inspections/photo-input.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/photo-service.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/photo-service.test.ts`

**Interfaces:**
- Consumes: `GoogleCloudLegManagerObjectStorage`, inspection photo table, and manager-leg ownership checks.
- Produces: `photoMetadataInputSchema`, `photoPatchSchema`, and `YearEndInspectionPhotoService`.
- Produces methods: `createMetadata`, `putImage`, `patchDescriptionAndAnnotations`, `listWithSignedUrls`, and `deletePhoto`.

- [ ] **Step 1: Write validation and storage tests**

```ts
it("accepts normalized ellipses and rejects out-of-range coordinates", () => {
  expect(photoPatchSchema.safeParse({ description: "Circle shows seam wear", annotations: { version: 1, ellipses: [{ id: "e1", x: 0.5, y: 0.4, radiusX: 0.1, radiusY: 0.08 }] } }).success).toBe(true);
  expect(photoPatchSchema.safeParse({ description: "bad", annotations: { version: 1, ellipses: [{ id: "e1", x: 1.4, y: 0.4, radiusX: 0.1, radiusY: 0.08 }] } }).success).toBe(false);
});

it("keeps the original object when annotation metadata changes", async () => {
  const photo = await service.createMetadata(input, legId);
  await service.putImage(photo.id, legId, jpegBytes, "image/jpeg");
  await service.patchDescriptionAndAnnotations(photo.id, legId, patch);
  expect(storage.put).toHaveBeenCalledTimes(1);
  expect(storage.delete).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the photo service test and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/photo-service.test.ts`

Expected: FAIL because the service is missing.

- [ ] **Step 3: Implement strict image and annotation validation**

```ts
const normalizedNumber = z.number().finite().min(0).max(1);
export const annotationDocumentSchema = z.object({
  version: z.literal(1),
  ellipses: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    x: normalizedNumber,
    y: normalizedNumber,
    radiusX: normalizedNumber.refine(value => value > 0),
    radiusY: normalizedNumber.refine(value => value > 0),
  })).max(50),
}).strict();
```

Allow JPEG, PNG, and WebP up to 15 MiB. Use `year-end-inspections/{legId}/{inspectionId}/{entryId}/{photoId}` object keys and 15-minute signed read URLs. Keep the original object during description/annotation updates.

- [ ] **Step 4: Run photo tests and typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/features/year-end-inspections/photo-service.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit secure photo support**

```bash
git add artifacts/api-server/src/features/year-end-inspections/photo-*.ts
git commit -m "feat(inspections): store annotated inspection photos"
```

---

### Task 5: Expose manager, admin, and boss APIs

**Files:**
- Create: `artifacts/api-server/src/routes/manager-year-end-inspections.ts`
- Create: `artifacts/api-server/src/routes/manager-year-end-inspections.test.ts`
- Create: `artifacts/api-server/src/routes/admin-year-end-inspections.ts`
- Create: `artifacts/api-server/src/routes/admin-year-end-inspections.test.ts`
- Create: `artifacts/api-server/src/routes/boss-year-end-inspections.ts`
- Create: `artifacts/api-server/src/routes/boss-year-end-inspections.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/boss-operations.ts`

**Interfaces:**
- Consumes: Tasks 2-4 repositories and services.
- Produces manager endpoints under `/manager/year-end-inspections` scoped by `req.legManager!.legId`.
- Produces admin endpoints under `/manager-admin/year-end-inspections` and `/manager-admin/equipment-pieces`.
- Produces boss endpoints under `/boss/year-end-inspections` and a maintenance-dashboard projection.

- [ ] **Step 1: Write route authorization and idempotency tests**

```ts
it("does not allow a manager to load another leg's inspection", async () => {
  await request(app).get(`/manager/year-end-inspections/${otherLegInspectionId}`).set(managerCookie).expect(404);
});

it("returns the same inspection for a retried client mutation", async () => {
  const body = { year: 2026, source: "current_pieces", clientMutationId: mutationId };
  const first = await request(app).post("/manager/year-end-inspections").set(managerCookie).send(body).expect(201);
  const retry = await request(app).post("/manager/year-end-inspections").set(managerCookie).send(body).expect(200);
  expect(retry.body.inspection.id).toBe(first.body.inspection.id);
});
```

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/routes/manager-year-end-inspections.test.ts src/routes/admin-year-end-inspections.test.ts src/routes/boss-year-end-inspections.test.ts`

Expected: FAIL because routers are missing.

- [ ] **Step 3: Implement manager routes**

Provide routes for list/current-year detail, start blank, start from current pieces, copy prior year, add piece, patch entry, create photo metadata, upload photo bytes, patch photo, delete photo, and complete. Every lookup includes the authenticated manager leg ID.

```ts
router.patch("/manager/year-end-inspections/:inspectionId/entries/:entryId", requireManager, async (req, res) => {
  const parsed = inspectionEntryPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid inspection entry" });
  const entry = await service.patchEntryForLeg(param(req.params.inspectionId), param(req.params.entryId), req.legManager!.legId, parsed.data, managerActor(req));
  if (!entry) return res.status(404).json({ error: "Inspection entry not found" });
  res.json({ entry });
});
```

- [ ] **Step 4: Implement admin and boss routes plus maintenance projection**

Admin supports full piece CRUD, cross-leg transfer, regrouping, inspection reopen, repair follow-up, and list/detail filters. Boss supports list/detail, maintenance notes, reopen, and repair follow-up. Add annual inspection summary items to `checklistAndMaintenance` with `phase: "year_end_inspection"` and stable IDs prefixed only in the DTO, not the database.

- [ ] **Step 5: Run route tests and server verification**

Run: `pnpm --filter @workspace/api-server test -- src/routes/manager-year-end-inspections.test.ts src/routes/admin-year-end-inspections.test.ts src/routes/boss-year-end-inspections.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the API surface**

```bash
git add artifacts/api-server/src/routes/manager-year-end-inspections* artifacts/api-server/src/routes/admin-year-end-inspections* artifacts/api-server/src/routes/boss-year-end-inspections* artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/boss-operations.ts
git commit -m "feat(inspections): expose manager and owner APIs"
```

---

### Task 6: Extend offline storage and build annotation primitives

**Files:**
- Modify: `artifacts/adventure-zone/src/lib/manager-blob-queue.ts`
- Modify: `artifacts/adventure-zone/src/lib/manager-offline-db.ts`
- Create: `artifacts/adventure-zone/src/lib/inspection-photo-annotations.ts`
- Create: `artifacts/adventure-zone/src/lib/inspection-photo-annotations.test.ts`
- Create: `artifacts/adventure-zone/src/components/manager/inspection-photo-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/inspection-photo-editor.test.tsx`

**Interfaces:**
- Consumes: existing manager mutation/blob queue contracts and Task 5 photo endpoints.
- Produces blob kind `year_end_inspection_photo` and contextual fields `inspectionId`, `entryId`, and `photoId`.
- Produces `pointerEllipse(start, end, bounds): PhotoEllipse` and `ellipseStyle(ellipse): CSSProperties`.
- Produces `<InspectionPhotoEditor inspectionId entryId onSaved />`.

- [ ] **Step 1: Write normalized-coordinate and offline-queue tests**

```ts
it("normalizes a dragged circle against the displayed image", () => {
  expect(pointerEllipse({ x: 110, y: 70 }, { x: 210, y: 130 }, { left: 10, top: 10, width: 400, height: 200 })).toMatchObject({
    x: 0.375,
    y: 0.3,
    radiusX: 0.125,
    radiusY: 0.15,
  });
});
```

- [ ] **Step 2: Run focused web tests and verify failure**

Run: `pnpm --filter @workspace/adventure-zone test -- src/lib/inspection-photo-annotations.test.ts src/components/manager/inspection-photo-editor.test.tsx`

Expected: FAIL because the modules are missing.

- [ ] **Step 3: Extend the queue without breaking existing blob kinds**

```ts
export type ManagerBlobKind = "receipt" | "incident" | "checklist_attachment" | "year_end_inspection_photo";
export type ManagerBlobRow = {
  id: string;
  legId: string;
  receiptId: string;
  kind?: ManagerBlobKind;
  bookingId?: string;
  inspectionId?: string;
  entryId?: string;
  photoId?: string;
  blob: Blob;
  createdAt: string;
  state: ManagerBlobState;
  lastError?: string;
};
```

Validate that the new kind includes all three context IDs. Keep IndexedDB version upgrades additive so existing queued receipts/incidents remain readable.

- [ ] **Step 4: Implement the accessible photo editor**

Use a canvas overlay for pointer drawing and a positioned SVG overlay for saved ellipses. Provide **Circle an area**, **Undo circle**, and **Clear circles** controls; render the textarea immediately beneath the image; queue metadata first, then the original blob; and display `ManagerSyncStatus` for offline/upload errors.

- [ ] **Step 5: Run focused tests and frontend typecheck**

Run: `pnpm --filter @workspace/adventure-zone test -- src/lib/inspection-photo-annotations.test.ts src/components/manager/inspection-photo-editor.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 6: Commit offline annotated-photo support**

```bash
git add artifacts/adventure-zone/src/lib/manager-blob-queue.ts artifacts/adventure-zone/src/lib/manager-offline-db.ts artifacts/adventure-zone/src/lib/inspection-photo-annotations* artifacts/adventure-zone/src/components/manager/inspection-photo-editor*
git commit -m "feat(inspections): add offline photo annotation editor"
```

---

### Task 7: Build the manager year-end inspection workflow

**Files:**
- Create: `artifacts/adventure-zone/src/lib/year-end-inspections-api.ts`
- Create: `artifacts/adventure-zone/src/components/manager/year-end-inspection-progress.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/year-end-inspection-entry-card.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerYearEndInspectionPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerYearEndInspectionPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 manager endpoints, Task 6 photo editor, existing `useManagerAuth`, and offline mutation queue.
- Produces manager route `/manager/year-end-inspection`.
- Produces the current-year dashboard, start/copy chooser, searchable piece list, condition editor, add-piece form, and completion review.

- [ ] **Step 1: Write the mobile workflow test**

```tsx
it("starts from current pieces and blocks completion until all entries resolve", async () => {
  renderManagerInspection({ width: 390, api });
  await user.click(await screen.findByRole("button", { name: "Use pieces assigned to this leg" }));
  expect(await screen.findByText("0 of 2 inspected")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /AZ-017 Front section/ }));
  await user.selectOptions(screen.getByLabelText("Condition"), "minor_repair");
  await user.type(screen.getByLabelText("Inspection notes"), "Worn seam near entrance");
  await user.click(screen.getByRole("button", { name: "Save piece inspection" }));
  expect(screen.getByText("1 of 2 inspected")).toBeVisible();
  expect(screen.getByRole("button", { name: "Complete inspection" })).toBeDisabled();
});
```

- [ ] **Step 2: Run the page test and verify failure**

Run: `pnpm --filter @workspace/adventure-zone test -- src/pages/ManagerYearEndInspectionPage.test.tsx`

Expected: FAIL because the page does not exist.

- [ ] **Step 3: Implement DTOs, start choices, progress, filters, and entry editing**

```ts
export type YearEndInspectionSummaryDto = {
  id: string;
  legId: string;
  inspectionYear: number;
  status: "draft" | "in_progress" | "completed";
  progress: { total: number; notStarted: number; inspected: number; notPresent: number; needsAttention: number; percentComplete: number };
  updatedAt: string;
  completedAt: string | null;
};
```

Use one-column cards at narrow widths, 44-pixel minimum touch targets, sticky progress/completion controls, and filters for all, not started, inspected, attention, and not present. Save entry changes through the offline mutation queue and refresh from the server after synchronization.

- [ ] **Step 4: Add navigation from Manager Operations and app routing**

Add a prominent **Year-End Inspection** card in `ManagerOperationsPage` showing the current-year count when available. Lazy-load the page in `App.tsx` and keep it inside `ManagerAuthProvider`.

- [ ] **Step 5: Run page tests, route tests, and typecheck**

Run: `pnpm --filter @workspace/adventure-zone test -- src/pages/ManagerYearEndInspectionPage.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the manager workflow**

```bash
git add artifacts/adventure-zone/src/lib/year-end-inspections-api.ts artifacts/adventure-zone/src/components/manager/year-end-inspection-* artifacts/adventure-zone/src/pages/ManagerYearEndInspectionPage* artifacts/adventure-zone/src/pages/ManagerOperationsPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat(inspections): add manager year-end workflow"
```

---

### Task 8: Build admin inventory and inspection controls

**Files:**
- Create: `artifacts/adventure-zone/src/components/year-end-inspections/inspection-record-view.tsx`
- Create: `artifacts/adventure-zone/src/components/year-end-inspections/piece-inventory-table.tsx`
- Create: `artifacts/adventure-zone/src/pages/YearEndInspectionsAdminPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/YearEndInspectionsAdminPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-manager-cards.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Consumes: Task 5 admin endpoints and shared record DTOs.
- Produces admin route `/year-end-inspections` with leg/year filters, repeated quick-add, search, grouping, transfer, regroup, archive/restore, reopen, and repair resolution.
- Extends `LegResourceSummary` with optional `yearEndInspectionSummary` without changing existing resource counts.

- [ ] **Step 1: Write admin behavior tests**

```tsx
it("quick-adds pieces without a fixed inventory limit", async () => {
  renderAdminPage({ api });
  await user.click(screen.getByRole("button", { name: "Add piece" }));
  await user.type(screen.getByLabelText("Piece code"), "AZ-059");
  await user.type(screen.getByLabelText("Piece name"), "Warrior wall section");
  await user.selectOptions(screen.getByLabelText("Leg"), legId);
  await user.click(screen.getByRole("button", { name: "Save and add another" }));
  expect(await screen.findByText("AZ-059")).toBeVisible();
  expect(screen.getByLabelText("Piece code")).toHaveValue("");
});

it("shows inspection progress on the leg card", () => {
  renderLegCard({ yearEndInspectionSummary: { inspected: 42, total: 58, needsAttention: 6 } });
  expect(screen.getByText("42 of 58 inspected")).toBeVisible();
  expect(screen.getByText("6 need repair")).toBeVisible();
});
```

- [ ] **Step 2: Run admin tests and verify failure**

Run: `pnpm --filter @workspace/adventure-zone test -- src/pages/YearEndInspectionsAdminPage.test.tsx src/components/routes/travel-leg-manager-cards.test.tsx`

Expected: FAIL because the route/components are missing or do not expose the summary.

- [ ] **Step 3: Implement piece inventory and repeated quick-add**

Support filters for leg, attraction, unassigned/spare, lifecycle status, condition, and storage location. **Save and add another** retains selected leg, attraction, type, and storage location while clearing code/name/notes. Do not preload fabricated rows.

- [ ] **Step 4: Implement admin inspection review and follow-up actions**

Render original condition, notes, photos, SVG ellipse overlays, photo description underneath, audit history, and linked maintenance status. Reopen and repair-complete actions require confirmation and refresh the record without mutating the original inspection condition.

- [ ] **Step 5: Add current-year summaries to leg cards and app routing**

Show `No inspection started`, `N of M inspected`, or `Completed`, plus attention count and a link to `/year-end-inspections?legId=...&year=...`. Add the lazy route to `App.tsx` under the existing owner/admin shell.

- [ ] **Step 6: Run admin tests and frontend verification**

Run: `pnpm --filter @workspace/adventure-zone test -- src/pages/YearEndInspectionsAdminPage.test.tsx src/components/routes/travel-leg-manager-cards.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 7: Commit admin inventory and inspection controls**

```bash
git add artifacts/adventure-zone/src/components/year-end-inspections artifacts/adventure-zone/src/pages/YearEndInspectionsAdminPage* artifacts/adventure-zone/src/components/routes/travel-leg-manager-cards.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/pages/RoutesPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat(inspections): add owner inventory and review tools"
```

---

### Task 9: Integrate boss maintenance records and finish acceptance verification

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/BossMaintenancePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BossMaintenancePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/lib/boss-types.ts`
- Create: `artifacts/api-server/src/features/year-end-inspections/year-end-inspection-acceptance.pglite.test.ts`
- Create: `artifacts/adventure-zone/src/pages/YearEndInspectionAcceptance.test.tsx`

**Interfaces:**
- Consumes: Task 5 boss endpoints and Task 8 `InspectionRecordView`.
- Produces boss maintenance grouping for `phase: "year_end_inspection"`, detailed review, reopen, maintenance note, and repair resolution.
- Produces end-to-end acceptance coverage for history, permissions, offline retry, private photo metadata, and repair evidence separation.

- [ ] **Step 1: Write boss maintenance integration tests**

```tsx
it("shows a completed leg inspection in maintenance with photos and repair follow-up", async () => {
  renderBossMaintenance({ dashboard: completedInspectionDashboard, detail: inspectionDetail });
  await user.click(await screen.findByRole("button", { name: /Leg 3.*2026 year-end inspection/ }));
  expect(await screen.findByText("Anchor panel tear")).toBeVisible();
  expect(screen.getByAltText("Circle shows the worn anchor panel")).toBeVisible();
  expect(screen.getByText("Circle shows the worn anchor panel")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark repair completed" })).toBeVisible();
});
```

- [ ] **Step 2: Run boss tests and verify failure**

Run: `pnpm --filter @workspace/adventure-zone test -- src/pages/BossMaintenancePage.test.tsx`

Expected: FAIL because annual inspection records are not rendered.

- [ ] **Step 3: Add annual inspection grouping and shared detail rendering**

Extend `phaseLabel()` with `year_end_inspection: "Year-end inspection"`. Group by inspection ID rather than booking ID when `recordKind === "year_end_inspection"`. Render `InspectionRecordView` inside the expanded maintenance card and wire boss reopen/note/repair actions through existing boss-auth request helpers.

- [ ] **Step 4: Add API acceptance coverage**

The PGlite acceptance test executes this exact story: create 60 pieces; group components into two resources; start Leg 1's 2026 inspection; retry the creation mutation; mark every entry resolved; attach a repair photo with an ellipse and description; complete; verify another leg manager receives 404; verify boss can read; resolve the repair; regroup one piece; copy to 2027; then verify the 2026 snapshots, original condition, original assignment, and photo metadata are unchanged.

- [ ] **Step 5: Add browser acceptance coverage**

The frontend acceptance test uses a 390px viewport, starts/copies an inspection, edits notes, queues a photo while offline, restores online state, verifies sync status, completes after all entries resolve, then renders the same record in boss maintenance with the description beneath the annotated image.

- [ ] **Step 6: Run the complete targeted verification suite**

```bash
pnpm --filter @workspace/api-server test -- src/db/year-end-inspection-required-startup.test.ts src/features/year-end-inspections src/routes/manager-year-end-inspections.test.ts src/routes/admin-year-end-inspections.test.ts src/routes/boss-year-end-inspections.test.ts
pnpm --filter @workspace/adventure-zone test -- src/lib/inspection-photo-annotations.test.ts src/components/manager/inspection-photo-editor.test.tsx src/pages/ManagerYearEndInspectionPage.test.tsx src/pages/YearEndInspectionsAdminPage.test.tsx src/pages/BossMaintenancePage.test.tsx src/pages/YearEndInspectionAcceptance.test.tsx
pnpm run typecheck
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/api-server build
```

Expected: all tests, typechecks, and builds PASS. Existing event checklists, receipts, incident photos, maintenance records, and routes remain green.

- [ ] **Step 7: Commit the boss integration and acceptance proof**

```bash
git add artifacts/adventure-zone/src/pages/BossMaintenancePage.tsx artifacts/adventure-zone/src/pages/BossMaintenancePage.test.tsx artifacts/adventure-zone/src/lib/boss-types.ts artifacts/api-server/src/features/year-end-inspections/year-end-inspection-acceptance.pglite.test.ts artifacts/adventure-zone/src/pages/YearEndInspectionAcceptance.test.tsx
git commit -m "feat(inspections): surface annual records in boss maintenance"
```

---

## Final Review Checklist

- [ ] Confirm there is no constant, validation limit, or pagination assumption tied to 58 pieces.
- [ ] Confirm every manager repository query includes the authenticated leg ID.
- [ ] Confirm photo objects are private and signed URLs expire.
- [ ] Confirm annotation edits never rewrite or delete original image bytes.
- [ ] Confirm inspection completion waits for resolved entries and required repair-photo descriptions.
- [ ] Confirm repair completion leaves the original entry condition and notes unchanged.
- [ ] Confirm copy-forward creates new entries and snapshots rather than sharing mutable rows.
- [ ] Confirm archived/transferred/regrouped pieces remain visible in historical inspections.
- [ ] Confirm the manager workflow works at 390px width and retains offline data across refresh.
- [ ] Confirm admin and boss find the record inside maintenance grouped by leg and year.
