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
import { photoPatchSchema } from "./photo-input";
import { YearEndInspectionPhotoService } from "./photo-service";

const clients: PGlite[] = [];
const legId = "10000000-0000-4000-8000-000000000001";

class MemoryStorage {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  deletes: string[] = [];
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.objects.set(key, { bytes, contentType });
  }
  async getSignedReadUrl(key: string) {
    return `https://signed.example/${key}`;
  }
  async delete(key: string) {
    this.deletes.push(key);
    this.objects.delete(key);
  }
}

async function setup() {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
    CREATE TABLE travel_legs (id uuid PRIMARY KEY, name text NOT NULL, color text NOT NULL DEFAULT '#000', sort_order integer NOT NULL, archived_at timestamptz);
    CREATE TABLE resources (id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL, category text NOT NULL, status text NOT NULL DEFAULT 'available');
    INSERT INTO travel_legs (id, name, sort_order) VALUES ('${legId}', 'Leg One', 1);
  `);
  await client.exec(YEAR_END_INSPECTION_SCHEMA_SQL);
  const db = drizzle(client, { schema: yearEndSchema }) as never;
  const pieces = new DrizzlePieceRepository(db);
  await pieces.create({
    code: "P-1", name: "Wall", pieceType: "inflatable_component", currentLegId: legId,
    storageLocation: null, identityNotes: null, lifecycleStatus: "active", resourceId: null,
  }, "manager:1");
  const inspection = await new YearEndInspectionService(db).startForCurrentPieces({
    legId, year: 2026, clientMutationId: crypto.randomUUID(), actorId: "manager:1",
  });
  const storage = new MemoryStorage();
  return {
    storage,
    entryId: inspection.entries[0]!.id,
    inspectionId: inspection.id,
    service: new YearEndInspectionPhotoService(db, storage),
  };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("year-end inspection photo validation", () => {
  it("accepts normalized circles and rejects coordinates outside the photo", () => {
    expect(photoPatchSchema.safeParse({
      description: "Circle shows seam wear",
      annotations: { version: 1, ellipses: [{ id: "e1", x: 0.5, y: 0.4, radiusX: 0.1, radiusY: 0.08 }] },
    }).success).toBe(true);
    expect(photoPatchSchema.safeParse({
      description: "Outside",
      annotations: { version: 1, ellipses: [{ id: "e1", x: 1.4, y: 0.4, radiusX: 0.1, radiusY: 0.08 }] },
    }).success).toBe(false);
  });

  it("stores the original once and edits annotations without replacing image bytes", async () => {
    const { service, storage, inspectionId, entryId } = await setup();
    const photo = await service.createMetadata({
      id: crypto.randomUUID(),
      clientMutationId: crypto.randomUUID(),
      inspectionId,
      entryId,
      legId,
      mimeType: "image/jpeg",
      description: "Original view",
      annotations: { version: 1, ellipses: [] },
    });
    await service.putImage(photo.id, legId, new Uint8Array([1, 2, 3]), "image/jpeg");
    await service.patchDescriptionAndAnnotations(photo.id, legId, {
      description: "Circle shows seam wear",
      annotations: { version: 1, ellipses: [{ id: "e1", x: 0.5, y: 0.5, radiusX: 0.2, radiusY: 0.1 }] },
    });

    expect(storage.objects.size).toBe(1);
    expect(storage.deletes).toEqual([]);
    const [saved] = await service.listWithSignedUrls(entryId, legId);
    expect(saved).toMatchObject({
      description: "Circle shows seam wear",
      annotations: { version: 1, ellipses: [{ id: "e1" }] },
      imageUrl: expect.stringContaining("https://signed.example/"),
    });
    expect(await service.belongsToInspection(photo.id, inspectionId, legId)).toBe(true);
    expect(await service.belongsToInspection(photo.id, crypto.randomUUID(), legId)).toBe(false);
  });

  it("rejects unsupported formats and images larger than 15 MiB", async () => {
    const { service, inspectionId, entryId } = await setup();
    const photo = await service.createMetadata({
      id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(),
      inspectionId, entryId, legId, mimeType: "image/jpeg",
      description: "Evidence", annotations: { version: 1, ellipses: [] },
    });
    await expect(service.putImage(photo.id, legId, new Uint8Array([1]), "image/gif"))
      .rejects.toThrow("PHOTO_TYPE_UNSUPPORTED");
    await expect(service.putImage(photo.id, legId, new Uint8Array(15 * 1024 * 1024 + 1), "image/jpeg"))
      .rejects.toThrow("PHOTO_TOO_LARGE");
  });

  it("deletes stored photos for one removed inspection entry", async () => {
    const { service, storage, inspectionId, entryId } = await setup();
    const photo = await service.createMetadata({
      id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(),
      inspectionId, entryId, legId, mimeType: "image/jpeg",
      description: "Duplicate piece", annotations: { version: 1, ellipses: [] },
    });
    await service.putImage(photo.id, legId, new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(await service.deleteForEntry(entryId, legId)).toEqual({ deletedPhotos: 1 });
    expect(storage.deletes).toHaveLength(1);
    expect(await service.listWithSignedUrls(entryId, legId)).toEqual([]);
  });

  it("deletes every stored photo for an inspection before an admin reset", async () => {
    const { service, storage, inspectionId, entryId } = await setup();
    const photo = await service.createMetadata({
      id: crypto.randomUUID(), clientMutationId: crypto.randomUUID(),
      inspectionId, entryId, legId, mimeType: "image/jpeg",
      description: "Test photo", annotations: { version: 1, ellipses: [] },
    });
    await service.putImage(photo.id, legId, new Uint8Array([1, 2, 3]), "image/jpeg");

    expect(await service.deleteForInspection(inspectionId)).toEqual({ deletedPhotos: 1 });
    expect(storage.deletes).toHaveLength(1);
    expect(await service.listWithSignedUrls(entryId, legId)).toEqual([]);
  });
});
