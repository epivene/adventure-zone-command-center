import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import * as yearEndSchema from "@workspace/db/year-end-inspection-schema";
import { YEAR_END_INSPECTION_SCHEMA_SQL } from "@/db/year-end-inspection-required-startup";
import { DrizzlePieceRepository } from "./piece-repository";
import { YearEndInspectionService } from "./inspection-service";

const clients: PGlite[] = [];
const legId = "10000000-0000-4000-8000-000000000001";
const resourceId = "20000000-0000-4000-8000-000000000001";
const actor = "manager:leg-one";

async function setup() {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
    CREATE TABLE travel_legs (
      id uuid PRIMARY KEY, name text NOT NULL, color text NOT NULL DEFAULT '#000000',
      sort_order integer NOT NULL, archived_at timestamptz
    );
    CREATE TABLE resources (
      id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL, category text NOT NULL,
      status text NOT NULL DEFAULT 'available', normal_travel_leg_id uuid
    );
    INSERT INTO travel_legs (id, name, sort_order) VALUES ('${legId}', 'Leg One', 1);
    INSERT INTO resources (id, code, name, category, status, normal_travel_leg_id) VALUES
      ('${resourceId}', 'WP', 'Warrior Playground', 'inflatable', 'available', '${legId}');
  `);
  await client.exec(YEAR_END_INSPECTION_SCHEMA_SQL);
  const db = drizzle(client, { schema: yearEndSchema }) as never;
  const pieces = new DrizzlePieceRepository(db);
  const piece = await pieces.create({
    code: "WP-001", name: "Front wall section", pieceType: "inflatable_component",
    currentLegId: legId, storageLocation: "Trailer 1", identityNotes: null,
    lifecycleStatus: "active", resourceId,
  }, actor);
  return { client, service: new YearEndInspectionService(db), piece, pieces };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("YearEndInspectionService", () => {
  it("copies a prior leg list into independent new-year snapshots", async () => {
    const { service } = await setup();
    const prior = await service.startForCurrentPieces({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });
    await service.patchEntry(prior.entries[0]!.id, {
      entryState: "inspected",
      condition: "minor_repair",
      inspectionNotes: "Seam wear",
      repairNeeded: true,
      repairNotes: "Patch before storage",
      retainForFutureUse: true,
    }, actor);

    const next = await service.copyPriorYear({
      legId,
      year: 2027,
      sourceInspectionId: prior.id,
      clientMutationId: crypto.randomUUID(),
      actorId: actor,
    });

    expect(next.entries[0]).toMatchObject({
      pieceNameSnapshot: "Front wall section",
      resourceNameSnapshot: "Warrior Playground",
      entryState: "not_started",
      condition: null,
      inspectionNotes: null,
    });
    expect(next.entries[0]!.id).not.toBe(prior.entries[0]!.id);
  });

  it("creates a newly discovered piece on the manager's leg and adds it to a blank inspection idempotently", async () => {
    const { service } = await setup();
    const inspection = await service.startBlank({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });
    const input = {
      pieceId: "40000000-0000-4000-8000-000000000001",
      entryId: "50000000-0000-4000-8000-000000000001",
      clientMutationId: "60000000-0000-4000-8000-000000000001",
      code: null,
      name: "Blue slide section",
      identityNotes: "Rolled beside the generator",
      resourceId,
    };

    const created = await service.createDiscoveredPieceForLeg(inspection.id, legId, input, actor);
    const retried = await service.createDiscoveredPieceForLeg(inspection.id, legId, input, actor);

    expect(created.entries).toHaveLength(1);
    expect(retried.entries).toHaveLength(1);
    expect(retried.entries[0]).toMatchObject({
      id: input.entryId,
      pieceId: input.pieceId,
      pieceNameSnapshot: "Blue slide section",
      resourceNameSnapshot: "Warrior Playground",
      entryState: "not_started",
    });
  });

  it("blocks completion until every piece is inspected or deliberately not present", async () => {
    const { service } = await setup();
    const inspection = await service.startForCurrentPieces({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });

    await expect(service.complete(inspection.id, actor)).rejects.toMatchObject({
      code: "inspection_incomplete",
    });

    await service.patchEntry(inspection.entries[0]!.id, {
      entryState: "not_present",
      condition: null,
      inspectionNotes: "Stored offsite",
      repairNeeded: false,
      repairNotes: null,
      retainForFutureUse: true,
    }, actor);
    await expect(service.complete(inspection.id, actor)).resolves.toMatchObject({
      status: "completed",
      completedAt: expect.any(Date),
    });
  });

  it("projects one repair item and preserves the original finding after resolution", async () => {
    const { service } = await setup();
    const inspection = await service.startForCurrentPieces({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });
    const entryId = inspection.entries[0]!.id;
    await service.patchEntry(entryId, {
      entryState: "inspected",
      condition: "major_repair",
      inspectionNotes: "Anchor panel tear",
      repairNeeded: true,
      repairNotes: "Patch before next season",
      retainForFutureUse: true,
    }, actor);
    await service.patchEntry(entryId, { inspectionNotes: "Anchor panel tear photographed" }, actor);

    let detail = await service.get(inspection.id);
    expect(detail?.entries[0]?.maintenanceItem).toMatchObject({ state: "open" });
    await service.resolveMaintenanceItem(detail!.entries[0]!.maintenanceItem!.id, {
      resolutionNotes: "Patched and pressure tested",
    }, "owner:1");

    detail = await service.get(inspection.id);
    expect(detail?.entries[0]).toMatchObject({
      condition: "major_repair",
      inspectionNotes: "Anchor panel tear photographed",
      maintenanceItem: { state: "resolved", resolutionNotes: "Patched and pressure tested" },
    });
  });

  it("fully resets an inspection while deleting only pieces created by that manager during it", async () => {
    const { service, piece: existingPiece, pieces } = await setup();
    const inspection = await service.startForCurrentPieces({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });
    const discoveredPieceId = "40000000-0000-4000-8000-000000000001";
    await service.createDiscoveredPieceForLeg(inspection.id, legId, {
      pieceId: discoveredPieceId,
      entryId: "50000000-0000-4000-8000-000000000001",
      clientMutationId: "60000000-0000-4000-8000-000000000001",
      code: null,
      name: "Kristy's test section",
      identityNotes: "Created during the test inspection",
      resourceId: null,
    }, actor);

    expect(await service.resetForAdmin(inspection.id, { deleteDiscoveredPieces: true, actorId: "owner" }))
      .toEqual({ deletedPieces: 1 });
    expect(await service.get(inspection.id)).toBeNull();
    expect(await pieces.get(discoveredPieceId)).toBeNull();
    expect(await pieces.get(existingPiece.id)).not.toBeNull();
  });

  it("removes an accidental discovered piece without removing existing inventory", async () => {
    const { service, piece: existingPiece, pieces } = await setup();
    const inspection = await service.startForCurrentPieces({
      legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: actor,
    });
    const discoveredPieceId = "40000000-0000-4000-8000-000000000001";
    const discoveredEntryId = "50000000-0000-4000-8000-000000000001";
    await service.createDiscoveredPieceForLeg(inspection.id, legId, {
      pieceId: discoveredPieceId,
      entryId: discoveredEntryId,
      clientMutationId: "60000000-0000-4000-8000-000000000001",
      code: null,
      name: "Duplicate balloon castle",
      identityNotes: null,
      resourceId: null,
    }, actor);

    const updated = await service.removeDiscoveredPieceForLeg(inspection.id, discoveredEntryId, legId, actor);

    expect(updated.entries.map((entry) => entry.pieceId)).toEqual([existingPiece.id]);
    expect(await pieces.get(discoveredPieceId)).toBeNull();
    expect(await pieces.get(existingPiece.id)).not.toBeNull();
    await expect(service.removeDiscoveredPieceForLeg(
      inspection.id,
      inspection.entries[0]!.id,
      legId,
      actor,
    )).rejects.toThrow("PIECE_NOT_DISCOVERED_DURING_INSPECTION");
  });
});
