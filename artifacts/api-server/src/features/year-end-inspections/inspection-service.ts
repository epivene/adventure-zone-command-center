import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import {
  equipmentPieceAssignments,
  equipmentPieces,
  resources,
  yearEndInspectionAuditEvents,
  yearEndInspectionEntries,
  yearEndInspectionMaintenanceItems,
  yearEndInspectionPhotos,
  yearEndLegInspections,
} from "@workspace/db";

import { DrizzleInspectionRepository, type EntrySeed } from "./inspection-repository";
import { YearEndMaintenanceProjection } from "./maintenance-projection";
import { DrizzlePieceRepository } from "./piece-repository";
import type { InspectionDetail, InspectionEntryPatch } from "./inspection-types";

type Database = any;

export class InspectionLifecycleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

export class YearEndInspectionService {
  private readonly repository: DrizzleInspectionRepository;
  private readonly maintenance: YearEndMaintenanceProjection;

  constructor(private readonly db: Database) {
    this.repository = new DrizzleInspectionRepository(db);
    this.maintenance = new YearEndMaintenanceProjection(db);
  }

  async get(id: string) {
    return this.repository.get(id);
  }

  async findByMutation(clientMutationId: string) {
    return this.repository.findByMutation(clientMutationId);
  }

  async getForLegYear(legId: string, year: number) {
    return this.repository.getForLegYear(legId, year);
  }

  async list() {
    return this.repository.list();
  }

  async listResourcesForLeg(legId: string) {
    return this.db.select({ id: resources.id, name: resources.name })
      .from(resources)
      .where(and(eq(resources.normalTravelLegId, legId), ne(resources.status, "archived")))
      .orderBy(asc(resources.name));
  }

  async startForCurrentPieces(input: {
    legId: string;
    year: number;
    clientMutationId: string;
    actorId: string;
  }): Promise<InspectionDetail> {
    const existing = await this.repository.findByMutation(input.clientMutationId);
    if (existing) return existing;
    const seeds = await this.repository.currentPieceSeeds(input.legId);
    const id = await this.repository.create({
      clientMutationId: input.clientMutationId,
      legId: input.legId,
      inspectionYear: input.year,
      managerIdentitySnapshot: input.actorId,
    }, seeds);
    return (await this.repository.get(id))!;
  }

  async startBlank(input: {
    legId: string;
    year: number;
    clientMutationId: string;
    actorId: string;
  }): Promise<InspectionDetail> {
    const existing = await this.repository.findByMutation(input.clientMutationId);
    if (existing) return existing;
    const id = await this.repository.create({
      clientMutationId: input.clientMutationId,
      legId: input.legId,
      inspectionYear: input.year,
      managerIdentitySnapshot: input.actorId,
    }, []);
    return (await this.repository.get(id))!;
  }

  async copyPriorYear(input: {
    legId: string;
    year: number;
    sourceInspectionId: string;
    clientMutationId: string;
    actorId: string;
  }): Promise<InspectionDetail> {
    const existing = await this.repository.findByMutation(input.clientMutationId);
    if (existing) return existing;
    const source = await this.repository.get(input.sourceInspectionId);
    if (!source || source.legId !== input.legId) throw new Error("SOURCE_INSPECTION_NOT_FOUND");
    const seeds: EntrySeed[] = source.entries.map((entry, index) => ({
      clientMutationId: crypto.randomUUID(),
      pieceId: entry.pieceId,
      pieceCodeSnapshot: entry.pieceCodeSnapshot,
      pieceNameSnapshot: entry.pieceNameSnapshot,
      resourceIdSnapshot: entry.resourceIdSnapshot,
      resourceNameSnapshot: entry.resourceNameSnapshot,
      sortOrder: index,
    }));
    const id = await this.repository.create({
      clientMutationId: input.clientMutationId,
      legId: input.legId,
      inspectionYear: input.year,
      copiedFromInspectionId: source.id,
      managerIdentitySnapshot: input.actorId,
    }, seeds);
    return (await this.repository.get(id))!;
  }

  async patchEntry(id: string, patch: InspectionEntryPatch, actorId: string) {
    const entry = await this.repository.patchEntry(id, patch, actorId);
    if (!entry) throw new Error("INSPECTION_ENTRY_NOT_FOUND");
    await this.maintenance.syncForEntry(id, actorId);
    return this.repository.getEntry(id);
  }

  async patchEntryForLeg(inspectionId: string, entryId: string, legId: string, patch: InspectionEntryPatch, actorId: string) {
    const inspection = await this.repository.get(inspectionId);
    const entry = await this.repository.getEntry(entryId);
    if (!inspection || inspection.legId !== legId || !entry || entry.inspectionId !== inspectionId) return null;
    return this.patchEntry(entryId, patch, actorId);
  }

  async complete(id: string, actorId: string): Promise<InspectionDetail> {
    const inspection = await this.repository.get(id);
    if (!inspection) throw new Error("INSPECTION_NOT_FOUND");
    if (inspection.entries.some((entry) => entry.entryState === "not_started")) {
      throw new InspectionLifecycleError("inspection_incomplete", "Every piece must be inspected or marked not present.");
    }
    await this.repository.markCompleted(id, actorId);
    return (await this.repository.get(id))!;
  }

  async reopen(id: string, actorId: string): Promise<InspectionDetail> {
    if (!await this.repository.get(id)) throw new Error("INSPECTION_NOT_FOUND");
    await this.repository.reopen(id, actorId);
    return (await this.repository.get(id))!;
  }

  async addPieceToInspection(inspectionId: string, pieceId: string): Promise<InspectionDetail> {
    const pieces = await this.db.select().from(yearEndInspectionEntries)
      .where(eq(yearEndInspectionEntries.inspectionId, inspectionId));
    const inspection = await this.repository.get(inspectionId);
    if (!inspection) throw new Error("INSPECTION_NOT_FOUND");
    const seed = (await this.repository.currentPieceSeeds(inspection.legId)).find((row) => row.pieceId === pieceId);
    if (!seed) throw new Error("PIECE_NOT_AVAILABLE_FOR_LEG");
    await this.repository.addEntry(inspectionId, { ...seed, sortOrder: pieces.length });
    return (await this.repository.get(inspectionId))!;
  }

  async createDiscoveredPieceForLeg(
    inspectionId: string,
    legId: string,
    input: {
      pieceId: string;
      entryId: string;
      clientMutationId: string;
      code: string | null;
      name: string | null;
      identityNotes: string | null;
      resourceId: string | null;
    },
    actorId: string,
  ): Promise<InspectionDetail> {
    let inspection = await this.repository.get(inspectionId);
    if (!inspection || inspection.legId !== legId) throw new Error("INSPECTION_NOT_FOUND");
    if (inspection.status === "completed") throw new InspectionLifecycleError("inspection_completed", "Reopen the inspection before adding another piece.");
    if (inspection.entries.some((entry) => entry.id === input.entryId || entry.pieceId === input.pieceId)) return inspection;

    const pieces = new DrizzlePieceRepository(this.db);
    let piece = await pieces.get(input.pieceId);
    if (piece && piece.currentLegId !== legId) throw new Error("PIECE_OUTSIDE_LEG");
    if (!piece) {
      piece = await pieces.create({
        id: input.pieceId,
        clientMutationId: input.clientMutationId,
        code: input.code?.trim() || `NEW-${input.pieceId.slice(0, 8).toUpperCase()}`,
        name: input.name?.trim() || "Unidentified inflatable piece",
        pieceType: "inflatable_component",
        currentLegId: legId,
        storageLocation: null,
        identityNotes: input.identityNotes,
        lifecycleStatus: "active",
        resourceId: input.resourceId,
      }, actorId);
    }

    inspection = (await this.repository.get(inspectionId))!;
    if (!inspection.entries.some((entry) => entry.pieceId === piece.id)) {
      await this.repository.addEntry(inspectionId, {
        id: input.entryId,
        clientMutationId: input.clientMutationId,
        pieceId: piece.id,
        pieceCodeSnapshot: piece.code,
        pieceNameSnapshot: piece.name,
        resourceIdSnapshot: piece.currentResourceId,
        resourceNameSnapshot: piece.currentResourceName,
        sortOrder: inspection.entries.length,
      });
    }
    return (await this.repository.get(inspectionId))!;
  }

  async canRemoveDiscoveredPieceForLeg(inspectionId: string, entryId: string, legId: string, actorId: string) {
    const [inspection] = await this.db.select().from(yearEndLegInspections)
      .where(and(eq(yearEndLegInspections.id, inspectionId), eq(yearEndLegInspections.legId, legId)))
      .limit(1);
    const [entry] = await this.db.select().from(yearEndInspectionEntries)
      .where(and(eq(yearEndInspectionEntries.id, entryId), eq(yearEndInspectionEntries.inspectionId, inspectionId)))
      .limit(1);
    if (!inspection || !entry) return false;
    const [createdDuringInspection] = await this.db.select({ pieceId: yearEndInspectionAuditEvents.pieceId })
      .from(yearEndInspectionAuditEvents)
      .where(and(
        eq(yearEndInspectionAuditEvents.pieceId, entry.pieceId),
        eq(yearEndInspectionAuditEvents.action, "piece_created"),
        eq(yearEndInspectionAuditEvents.actorId, inspection.managerIdentitySnapshot ?? actorId),
        gte(yearEndInspectionAuditEvents.createdAt, inspection.startedAt),
      ))
      .limit(1);
    const [otherReference] = await this.db.select({ id: yearEndInspectionEntries.id })
      .from(yearEndInspectionEntries)
      .where(and(eq(yearEndInspectionEntries.pieceId, entry.pieceId), ne(yearEndInspectionEntries.id, entryId)))
      .limit(1);
    return Boolean(createdDuringInspection && !otherReference);
  }

  async removeDiscoveredPieceForLeg(inspectionId: string, entryId: string, legId: string, actorId: string) {
    if (!await this.canRemoveDiscoveredPieceForLeg(inspectionId, entryId, legId, actorId)) {
      throw new Error("PIECE_NOT_DISCOVERED_DURING_INSPECTION");
    }
    await this.db.transaction(async (tx: Database) => {
      const [inspection] = await tx.select().from(yearEndLegInspections)
        .where(and(eq(yearEndLegInspections.id, inspectionId), eq(yearEndLegInspections.legId, legId)))
        .limit(1);
      const [entry] = await tx.select().from(yearEndInspectionEntries)
        .where(and(eq(yearEndInspectionEntries.id, entryId), eq(yearEndInspectionEntries.inspectionId, inspectionId)))
        .limit(1);
      if (!inspection || !entry) throw new Error("INSPECTION_ENTRY_NOT_FOUND");

      await tx.delete(yearEndInspectionMaintenanceItems).where(eq(yearEndInspectionMaintenanceItems.entryId, entryId));
      await tx.delete(yearEndInspectionPhotos).where(eq(yearEndInspectionPhotos.entryId, entryId));
      await tx.delete(yearEndInspectionEntries).where(eq(yearEndInspectionEntries.id, entryId));
      await tx.delete(equipmentPieceAssignments).where(eq(equipmentPieceAssignments.pieceId, entry.pieceId));
      await tx.delete(yearEndInspectionAuditEvents).where(eq(yearEndInspectionAuditEvents.pieceId, entry.pieceId));
      await tx.delete(equipmentPieces).where(eq(equipmentPieces.id, entry.pieceId));
      await tx.update(yearEndLegInspections).set({ updatedAt: new Date() })
        .where(eq(yearEndLegInspections.id, inspectionId));
      await tx.insert(yearEndInspectionAuditEvents).values({
        inspectionId,
        pieceId: null,
        action: "discovered_piece_removed",
        actorId,
        payload: { entryId, code: entry.pieceCodeSnapshot, name: entry.pieceNameSnapshot },
      });
    });
    return (await this.repository.get(inspectionId))!;
  }

  async resolveMaintenanceItem(itemId: string, input: { resolutionNotes: string }, actorId: string) {
    await this.maintenance.resolve(itemId, input, actorId);
  }

  async resetForAdmin(inspectionId: string, input: { deleteDiscoveredPieces: boolean; actorId: string }) {
    return this.db.transaction(async (tx: Database) => {
      const [inspection] = await tx.select().from(yearEndLegInspections)
        .where(eq(yearEndLegInspections.id, inspectionId)).limit(1);
      if (!inspection) throw new Error("INSPECTION_NOT_FOUND");
      const entries = await tx.select({ id: yearEndInspectionEntries.id, pieceId: yearEndInspectionEntries.pieceId })
        .from(yearEndInspectionEntries).where(eq(yearEndInspectionEntries.inspectionId, inspectionId));
      const entryIds = entries.map((entry: { id: string }) => entry.id);
      const pieceIds = entries.map((entry: { pieceId: string }) => entry.pieceId);
      let discoveredPieceIds: string[] = [];

      if (input.deleteDiscoveredPieces && inspection.startedAt && pieceIds.length) {
        const created = await tx.select({ pieceId: yearEndInspectionAuditEvents.pieceId })
          .from(yearEndInspectionAuditEvents)
          .where(and(
            inArray(yearEndInspectionAuditEvents.pieceId, pieceIds),
            eq(yearEndInspectionAuditEvents.action, "piece_created"),
            eq(yearEndInspectionAuditEvents.actorId, inspection.managerIdentitySnapshot ?? ""),
            gte(yearEndInspectionAuditEvents.createdAt, inspection.startedAt),
          ));
        const createdIds = created.map((row: { pieceId: string | null }) => row.pieceId).filter((id: string | null): id is string => Boolean(id));
        if (createdIds.length) {
          const otherReferences = await tx.select({ pieceId: yearEndInspectionEntries.pieceId })
            .from(yearEndInspectionEntries)
            .where(and(
              inArray(yearEndInspectionEntries.pieceId, createdIds),
              ne(yearEndInspectionEntries.inspectionId, inspectionId),
            ));
          const protectedIds = new Set(otherReferences.map((row: { pieceId: string }) => row.pieceId));
          discoveredPieceIds = createdIds.filter((id: string) => !protectedIds.has(id));
        }
      }

      if (entryIds.length) {
        await tx.delete(yearEndInspectionMaintenanceItems).where(inArray(yearEndInspectionMaintenanceItems.entryId, entryIds));
        await tx.delete(yearEndInspectionPhotos).where(inArray(yearEndInspectionPhotos.entryId, entryIds));
      }
      await tx.delete(yearEndInspectionEntries).where(eq(yearEndInspectionEntries.inspectionId, inspectionId));
      await tx.delete(yearEndInspectionAuditEvents).where(eq(yearEndInspectionAuditEvents.inspectionId, inspectionId));
      if (discoveredPieceIds.length) {
        await tx.delete(equipmentPieceAssignments).where(inArray(equipmentPieceAssignments.pieceId, discoveredPieceIds));
        await tx.delete(yearEndInspectionAuditEvents).where(inArray(yearEndInspectionAuditEvents.pieceId, discoveredPieceIds));
        await tx.delete(equipmentPieces).where(inArray(equipmentPieces.id, discoveredPieceIds));
      }
      await tx.delete(yearEndLegInspections).where(eq(yearEndLegInspections.id, inspectionId));
      return { deletedPieces: discoveredPieceIds.length };
    });
  }
}
