import { and, asc, eq, ne } from "drizzle-orm";
import { resources, yearEndInspectionEntries } from "@workspace/db";

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

  async resolveMaintenanceItem(itemId: string, input: { resolutionNotes: string }, actorId: string) {
    await this.maintenance.resolve(itemId, input, actorId);
  }
}
