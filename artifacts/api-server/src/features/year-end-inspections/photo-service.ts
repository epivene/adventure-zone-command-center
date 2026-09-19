import { and, asc, eq, inArray } from "drizzle-orm";
import {
  yearEndInspectionEntries,
  yearEndInspectionPhotos,
  yearEndLegInspections,
} from "@workspace/db";

import {
  photoMetadataInputSchema,
  photoPatchSchema,
  type PhotoMetadataInput,
  type PhotoPatch,
} from "./photo-input";

type Database = any;
type PhotoStorage = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete?(key: string): Promise<void>;
};

const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumBytes = 15 * 1024 * 1024;

export class YearEndInspectionPhotoService {
  constructor(private readonly db: Database, private readonly storage: PhotoStorage) {}

  async createMetadata(rawInput: PhotoMetadataInput) {
    const input = photoMetadataInputSchema.parse(rawInput);
    const [owner] = await this.db.select({
      inspectionId: yearEndInspectionEntries.inspectionId,
      legId: yearEndLegInspections.legId,
    }).from(yearEndInspectionEntries)
      .innerJoin(yearEndLegInspections, eq(yearEndLegInspections.id, yearEndInspectionEntries.inspectionId))
      .where(and(
        eq(yearEndInspectionEntries.id, input.entryId),
        eq(yearEndLegInspections.id, input.inspectionId),
        eq(yearEndLegInspections.legId, input.legId),
      )).limit(1);
    if (!owner) throw new Error("PHOTO_ENTRY_NOT_FOUND");
    const objectKey = `year-end-inspections/${input.legId}/${input.inspectionId}/${input.entryId}/${input.id}`;
    await this.db.insert(yearEndInspectionPhotos).values({
      id: input.id,
      clientMutationId: input.clientMutationId,
      entryId: input.entryId,
      legId: input.legId,
      objectKey,
      mimeType: input.mimeType,
      description: input.description,
      annotations: input.annotations,
    }).onConflictDoNothing({ target: yearEndInspectionPhotos.clientMutationId });
    const [photo] = await this.db.select().from(yearEndInspectionPhotos)
      .where(eq(yearEndInspectionPhotos.clientMutationId, input.clientMutationId)).limit(1);
    if (!photo) throw new Error("PHOTO_METADATA_CREATE_FAILED");
    return photo;
  }

  async putImage(photoId: string, legId: string, bytes: Uint8Array, contentType: string) {
    if (!supportedTypes.has(contentType)) throw new Error("PHOTO_TYPE_UNSUPPORTED");
    if (bytes.byteLength > maximumBytes) throw new Error("PHOTO_TOO_LARGE");
    return this.db.transaction(async (tx: Database) => {
      const [photo] = await tx.select().from(yearEndInspectionPhotos)
        .where(and(eq(yearEndInspectionPhotos.id, photoId), eq(yearEndInspectionPhotos.legId, legId)))
        .for("update")
        .limit(1);
      if (!photo?.objectKey) throw new Error("PHOTO_NOT_FOUND");
      if (photo.mimeType !== contentType) throw new Error("PHOTO_TYPE_MISMATCH");
      // Inspection photos are evidence: lock the row so simultaneous uploads cannot
      // both replace the original. A pending upload may finish after completion.
      if (photo.uploadStatus === "image_uploaded") return { alreadyUploaded: true };
      if (photo.uploadStatus !== "image_pending") throw new Error("PHOTO_UPLOAD_NOT_PENDING");
      await this.storage.put(photo.objectKey, bytes, contentType);
      await tx.update(yearEndInspectionPhotos).set({
        uploadStatus: "image_uploaded",
        uploadedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(yearEndInspectionPhotos.id, photoId));
      return { alreadyUploaded: false };
    });
  }

  async patchDescriptionAndAnnotations(photoId: string, legId: string, rawPatch: PhotoPatch) {
    const patch = photoPatchSchema.parse(rawPatch);
    const [photo] = await this.db.update(yearEndInspectionPhotos).set({
      ...patch,
      updatedAt: new Date(),
    }).where(and(eq(yearEndInspectionPhotos.id, photoId), eq(yearEndInspectionPhotos.legId, legId)))
      .returning();
    if (!photo) throw new Error("PHOTO_NOT_FOUND");
    return photo;
  }

  async listWithSignedUrls(entryId: string, legId: string) {
    const rows = await this.db.select().from(yearEndInspectionPhotos)
      .where(and(eq(yearEndInspectionPhotos.entryId, entryId), eq(yearEndInspectionPhotos.legId, legId)))
      .orderBy(asc(yearEndInspectionPhotos.sortOrder), asc(yearEndInspectionPhotos.createdAt));
    return Promise.all(rows.map(async (photo: typeof yearEndInspectionPhotos.$inferSelect) => ({
      ...photo,
      imageUrl: photo.uploadStatus === "image_uploaded" && photo.objectKey
        ? await this.storage.getSignedReadUrl(photo.objectKey, 15 * 60)
        : null,
    })));
  }

  async belongsToInspection(photoId: string, inspectionId: string, legId: string) {
    const [photo] = await this.db.select({ id: yearEndInspectionPhotos.id })
      .from(yearEndInspectionPhotos)
      .innerJoin(yearEndInspectionEntries, eq(yearEndInspectionEntries.id, yearEndInspectionPhotos.entryId))
      .where(and(
        eq(yearEndInspectionPhotos.id, photoId),
        eq(yearEndInspectionPhotos.legId, legId),
        eq(yearEndInspectionEntries.inspectionId, inspectionId),
      )).limit(1);
    return Boolean(photo);
  }

  async deletePhoto(photoId: string, legId: string) {
    const [photo] = await this.db.select().from(yearEndInspectionPhotos)
      .where(and(eq(yearEndInspectionPhotos.id, photoId), eq(yearEndInspectionPhotos.legId, legId))).limit(1);
    if (!photo) return false;
    if (photo.objectKey && this.storage.delete) await this.storage.delete(photo.objectKey);
    await this.db.delete(yearEndInspectionPhotos).where(eq(yearEndInspectionPhotos.id, photoId));
    return true;
  }

  async deleteForInspection(inspectionId: string) {
    const photos = await this.db.select({
      id: yearEndInspectionPhotos.id,
      objectKey: yearEndInspectionPhotos.objectKey,
    }).from(yearEndInspectionPhotos)
      .innerJoin(yearEndInspectionEntries, eq(yearEndInspectionEntries.id, yearEndInspectionPhotos.entryId))
      .where(eq(yearEndInspectionEntries.inspectionId, inspectionId));
    for (const photo of photos) {
      if (photo.objectKey && this.storage.delete) await this.storage.delete(photo.objectKey);
    }
    if (photos.length) {
      await this.db.delete(yearEndInspectionPhotos)
        .where(inArray(yearEndInspectionPhotos.id, photos.map((photo: { id: string }) => photo.id)));
    }
    return { deletedPhotos: photos.length };
  }

  async deleteForEntry(entryId: string, legId: string) {
    const photos = await this.db.select({
      id: yearEndInspectionPhotos.id,
      objectKey: yearEndInspectionPhotos.objectKey,
    }).from(yearEndInspectionPhotos)
      .where(and(eq(yearEndInspectionPhotos.entryId, entryId), eq(yearEndInspectionPhotos.legId, legId)));
    for (const photo of photos) {
      if (photo.objectKey && this.storage.delete) await this.storage.delete(photo.objectKey);
    }
    if (photos.length) {
      await this.db.delete(yearEndInspectionPhotos)
        .where(inArray(yearEndInspectionPhotos.id, photos.map((photo: { id: string }) => photo.id)));
    }
    return { deletedPhotos: photos.length };
  }
}
