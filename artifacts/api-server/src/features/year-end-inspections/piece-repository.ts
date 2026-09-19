import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import {
  equipmentPieceAssignments,
  equipmentPieces,
  resources,
  travelLegs,
  yearEndInspectionAuditEvents,
} from "@workspace/db";

import { pieceInputSchema, piecePatchSchema, type PieceInput, type PiecePatch } from "./piece-input";
import type { PieceAssignmentHistory, PieceInventoryRecord } from "./piece-types";

type Database = any;
export type PieceListFilters = {
  legId?: string;
  lifecycleStatus?: PieceInventoryRecord["lifecycleStatus"];
  resourceId?: string | null;
  includeArchived?: boolean;
};

function now() {
  return new Date();
}

export class DrizzlePieceRepository {
  constructor(private readonly db: Database) {}

  private async requireActiveLeg(database: Database, legId: string | null) {
    if (!legId) return;
    const [leg] = await database.select({ id: travelLegs.id, archivedAt: travelLegs.archivedAt })
      .from(travelLegs).where(eq(travelLegs.id, legId)).limit(1);
    if (!leg || leg.archivedAt) throw new Error("PIECE_LEG_UNAVAILABLE");
  }

  private async requireActiveResource(database: Database, resourceId: string) {
    const [resource] = await database.select({ id: resources.id, status: resources.status })
      .from(resources).where(eq(resources.id, resourceId)).limit(1);
    if (!resource || resource.status === "archived") throw new Error("PIECE_RESOURCE_UNAVAILABLE");
  }

  private async audit(database: Database, pieceId: string, action: string, actorId: string, payload: Record<string, unknown> = {}) {
    await database.insert(yearEndInspectionAuditEvents).values({
      pieceId,
      inspectionId: null,
      action,
      actorId,
      payload,
    });
  }

  async create(rawInput: PieceInput, actorId: string): Promise<PieceInventoryRecord> {
    const input = pieceInputSchema.parse(rawInput);
    const pieceId = await this.db.transaction(async (tx: Database) => {
      await this.requireActiveLeg(tx, input.currentLegId);
      if (input.resourceId) await this.requireActiveResource(tx, input.resourceId);
      const [piece] = await tx.insert(equipmentPieces).values({
        ...(input.id ? { id: input.id } : {}),
        code: input.code,
        name: input.name,
        pieceType: input.pieceType,
        currentLegId: input.currentLegId,
        storageLocation: input.storageLocation,
        identityNotes: input.identityNotes,
        lifecycleStatus: input.lifecycleStatus,
      }).returning({ id: equipmentPieces.id });
      if (!piece) throw new Error("PIECE_CREATE_FAILED");
      if (input.resourceId) {
        await tx.insert(equipmentPieceAssignments).values({
          pieceId: piece.id,
          resourceId: input.resourceId,
          actorId,
          reason: "Initial assignment",
        });
      }
      await this.audit(tx, piece.id, "piece_created", actorId, {
        legId: input.currentLegId,
        resourceId: input.resourceId,
      });
      return piece.id;
    });
    const created = await this.get(pieceId);
    if (!created) throw new Error("PIECE_CREATE_FAILED");
    return created;
  }

  async list(filters: PieceListFilters = {}): Promise<PieceInventoryRecord[]> {
    const conditions: SQL[] = [];
    if (!filters.includeArchived) conditions.push(isNull(equipmentPieces.archivedAt));
    if (filters.legId) conditions.push(eq(equipmentPieces.currentLegId, filters.legId));
    if (filters.lifecycleStatus) conditions.push(eq(equipmentPieces.lifecycleStatus, filters.lifecycleStatus));
    const pieces = await this.db.select({ id: equipmentPieces.id })
      .from(equipmentPieces)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(equipmentPieces.code));
    const records = (await Promise.all(pieces.map((piece: { id: string }) => this.get(piece.id))))
      .filter((piece): piece is PieceInventoryRecord => Boolean(piece));
    if (filters.resourceId === undefined) return records;
    return records.filter((piece) => piece.currentResourceId === filters.resourceId);
  }

  async get(id: string): Promise<PieceInventoryRecord | null> {
    const [row] = await this.db.select().from(equipmentPieces).where(eq(equipmentPieces.id, id)).limit(1);
    if (!row) return null;
    const historyRows = await this.db.select({
      id: equipmentPieceAssignments.id,
      resourceId: equipmentPieceAssignments.resourceId,
      resourceName: resources.name,
      assignedAt: equipmentPieceAssignments.assignedAt,
      removedAt: equipmentPieceAssignments.removedAt,
      actorId: equipmentPieceAssignments.actorId,
      reason: equipmentPieceAssignments.reason,
    }).from(equipmentPieceAssignments)
      .innerJoin(resources, eq(resources.id, equipmentPieceAssignments.resourceId))
      .where(eq(equipmentPieceAssignments.pieceId, id))
      .orderBy(asc(equipmentPieceAssignments.assignedAt));
    const assignmentHistory = historyRows as PieceAssignmentHistory[];
    const current = assignmentHistory.find((assignment) => assignment.removedAt === null) ?? null;
    return {
      ...row,
      currentResourceId: current?.resourceId ?? null,
      currentResourceName: current?.resourceName ?? null,
      assignmentHistory,
    } as PieceInventoryRecord;
  }

  async update(id: string, rawPatch: PiecePatch, actorId: string): Promise<PieceInventoryRecord | null> {
    const patch = piecePatchSchema.parse(rawPatch);
    const found = await this.db.transaction(async (tx: Database) => {
      if (patch.currentLegId !== undefined) await this.requireActiveLeg(tx, patch.currentLegId);
      const [updated] = await tx.update(equipmentPieces).set({ ...patch, updatedAt: now() })
        .where(eq(equipmentPieces.id, id)).returning({ id: equipmentPieces.id });
      if (!updated) return false;
      await this.audit(tx, id, "piece_updated", actorId, patch);
      return true;
    });
    return found ? this.get(id) : null;
  }

  async assignToResource(id: string, resourceId: string, actorId: string, reason: string | null): Promise<PieceInventoryRecord | null> {
    const found = await this.db.transaction(async (tx: Database) => {
      const [piece] = await tx.select({ id: equipmentPieces.id }).from(equipmentPieces)
        .where(eq(equipmentPieces.id, id)).limit(1);
      if (!piece) return false;
      await this.requireActiveResource(tx, resourceId);
      await tx.update(equipmentPieceAssignments).set({ removedAt: now() })
        .where(and(eq(equipmentPieceAssignments.pieceId, id), isNull(equipmentPieceAssignments.removedAt)));
      await tx.insert(equipmentPieceAssignments).values({ pieceId: id, resourceId, actorId, reason });
      await this.audit(tx, id, "piece_regrouped", actorId, { resourceId, reason });
      return true;
    });
    return found ? this.get(id) : null;
  }

  async clearResourceAssignment(id: string, actorId: string, reason: string | null): Promise<PieceInventoryRecord | null> {
    const found = await this.db.transaction(async (tx: Database) => {
      const [piece] = await tx.select({ id: equipmentPieces.id }).from(equipmentPieces)
        .where(eq(equipmentPieces.id, id)).limit(1);
      if (!piece) return false;
      await tx.update(equipmentPieceAssignments).set({ removedAt: now() })
        .where(and(eq(equipmentPieceAssignments.pieceId, id), isNull(equipmentPieceAssignments.removedAt)));
      await this.audit(tx, id, "piece_unassigned", actorId, { reason });
      return true;
    });
    return found ? this.get(id) : null;
  }

  async transferLeg(id: string, legId: string, actorId: string): Promise<PieceInventoryRecord | null> {
    const found = await this.db.transaction(async (tx: Database) => {
      await this.requireActiveLeg(tx, legId);
      const [piece] = await tx.update(equipmentPieces).set({ currentLegId: legId, updatedAt: now() })
        .where(eq(equipmentPieces.id, id)).returning({ id: equipmentPieces.id });
      if (!piece) return false;
      await this.audit(tx, id, "piece_transferred", actorId, { legId });
      return true;
    });
    return found ? this.get(id) : null;
  }

  async archive(id: string, actorId: string): Promise<PieceInventoryRecord | null> {
    const found = await this.db.transaction(async (tx: Database) => {
      const [piece] = await tx.update(equipmentPieces).set({ archivedAt: now(), updatedAt: now() })
        .where(eq(equipmentPieces.id, id)).returning({ id: equipmentPieces.id });
      if (!piece) return false;
      await this.audit(tx, id, "piece_archived", actorId);
      return true;
    });
    return found ? this.get(id) : null;
  }

  async restore(id: string, actorId: string): Promise<PieceInventoryRecord | null> {
    const found = await this.db.transaction(async (tx: Database) => {
      const [piece] = await tx.update(equipmentPieces).set({ archivedAt: null, updatedAt: now() })
        .where(eq(equipmentPieces.id, id)).returning({ id: equipmentPieces.id });
      if (!piece) return false;
      await this.audit(tx, id, "piece_restored", actorId);
      return true;
    });
    return found ? this.get(id) : null;
  }
}
