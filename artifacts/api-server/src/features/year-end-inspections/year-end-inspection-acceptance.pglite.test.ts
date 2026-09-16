import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test"; });

import * as schema from "@workspace/db/year-end-inspection-schema";
import { YEAR_END_INSPECTION_SCHEMA_SQL } from "@/db/year-end-inspection-required-startup";
import { DrizzlePieceRepository } from "./piece-repository";
import { YearEndInspectionService } from "./inspection-service";
import { YearEndInspectionPhotoService } from "./photo-service";

const clients: PGlite[] = [];
const legId = "10000000-0000-4000-8000-000000000001";
const resourceOne = "20000000-0000-4000-8000-000000000001";
const resourceTwo = "20000000-0000-4000-8000-000000000002";

afterEach(async () => { await Promise.all(clients.splice(0).map((client) => client.close())); });

describe("year-end inspection acceptance", () => {
  it("preserves the completed snapshot, photo evidence, and original finding across regrouping and copy-forward", async () => {
    const client = new PGlite();
    clients.push(client);
    await client.exec(`
      CREATE TABLE travel_legs (id uuid PRIMARY KEY, name text NOT NULL, color text NOT NULL DEFAULT '#000', sort_order integer NOT NULL, archived_at timestamptz);
      CREATE TABLE resources (id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL, category text NOT NULL, status text NOT NULL DEFAULT 'available', normal_travel_leg_id uuid);
      INSERT INTO travel_legs (id, name, sort_order) VALUES ('${legId}', 'Leg One', 1);
      INSERT INTO resources (id, code, name, category, normal_travel_leg_id) VALUES ('${resourceOne}', 'R1', 'Warrior Wall', 'inflatable', '${legId}'), ('${resourceTwo}', 'R2', 'Obstacle Course', 'inflatable', '${legId}');
    `);
    await client.exec(YEAR_END_INSPECTION_SCHEMA_SQL);
    const db = drizzle(client, { schema }) as never;
    const pieces = new DrizzlePieceRepository(db);
    const service = new YearEndInspectionService(db);
    const stored = new Map<string, Uint8Array>();
    const photos = new YearEndInspectionPhotoService(db, {
      async put(key, bytes) { stored.set(key, bytes); },
      async getSignedReadUrl(key) { return `signed://${key}`; },
    });
    const created = [];
    for (let index = 1; index <= 60; index += 1) created.push(await pieces.create({
      code: `AZ-${String(index).padStart(3, "0")}`,
      name: `Inflatable component ${index}`,
      pieceType: "inflatable_component",
      currentLegId: legId,
      storageLocation: "Seasonal storage",
      identityNotes: null,
      lifecycleStatus: "active",
      resourceId: index <= 30 ? resourceOne : resourceTwo,
    }, "owner"));

    const mutationId = crypto.randomUUID();
    const inspection = await service.startForCurrentPieces({ legId, year: 2026, clientMutationId: mutationId, actorId: "manager" });
    expect((await service.startForCurrentPieces({ legId, year: 2026, clientMutationId: mutationId, actorId: "manager" })).id).toBe(inspection.id);
    for (const [index, entry] of inspection.entries.entries()) await service.patchEntry(entry.id, index === 0 ? {
      entryState: "inspected", condition: "major_repair", inspectionNotes: "Anchor panel tear", repairNeeded: true, repairNotes: "Patch before reuse", retainForFutureUse: true,
    } : {
      entryState: "not_present", condition: null, inspectionNotes: "Stored and counted", repairNeeded: false, repairNotes: null, retainForFutureUse: true,
    }, "manager");

    const firstEntry = inspection.entries[0]!;
    const photoId = crypto.randomUUID();
    await photos.createMetadata({
      id: photoId, clientMutationId: crypto.randomUUID(), inspectionId: inspection.id, entryId: firstEntry.id, legId,
      mimeType: "image/jpeg", description: "Circle shows the worn anchor panel",
      annotations: { version: 1, ellipses: [{ id: "circle-1", x: .5, y: .5, radiusX: .1, radiusY: .1 }] },
    });
    await photos.putImage(photoId, legId, new Uint8Array([1, 2, 3]), "image/jpeg");
    const completed = await service.complete(inspection.id, "manager");
    const maintenanceId = completed.entries[0]!.maintenanceItem!.id;
    await service.resolveMaintenanceItem(maintenanceId, { resolutionNotes: "Patched and pressure tested" }, "boss");
    await pieces.assignToResource(created[0]!.id, resourceTwo, "owner", "2027 regrouping");
    const copied = await service.copyPriorYear({ legId, year: 2027, sourceInspectionId: inspection.id, clientMutationId: crypto.randomUUID(), actorId: "manager" });

    const historical = await service.get(inspection.id);
    expect(historical?.entries).toHaveLength(60);
    expect(historical?.entries[0]).toMatchObject({ resourceNameSnapshot: "Warrior Wall", condition: "major_repair", inspectionNotes: "Anchor panel tear", maintenanceItem: { state: "resolved" } });
    expect((await photos.listWithSignedUrls(firstEntry.id, legId))[0]).toMatchObject({ description: "Circle shows the worn anchor panel", imageUrl: expect.stringContaining("signed://"), annotations: { ellipses: [expect.objectContaining({ id: "circle-1" })] } });
    expect(copied.entries).toHaveLength(60);
    expect(copied.entries[0]).toMatchObject({ resourceNameSnapshot: "Warrior Wall", entryState: "not_started", condition: null });
  }, 30_000);
});
