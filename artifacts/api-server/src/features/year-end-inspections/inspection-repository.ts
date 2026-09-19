import { and, asc, eq, isNull } from "drizzle-orm";
import {
  equipmentPieceAssignments,
  equipmentPieces,
  resources,
  yearEndInspectionAuditEvents,
  yearEndInspectionEntries,
  yearEndInspectionMaintenanceItems,
  yearEndLegInspections,
} from "@workspace/db";

import type {
  InspectionDetail,
  InspectionEntryUpdate,
  InspectionEntryRecord,
  InspectionMaintenanceItem,
} from "./inspection-types";

type Database = any;

export type NewInspection = {
  id?: string;
  clientMutationId: string;
  legId: string;
  inspectionYear: number;
  copiedFromInspectionId?: string | null;
  managerIdentitySnapshot: string;
};

export type EntrySeed = {
  id?: string;
  clientMutationId: string;
  pieceId: string;
  pieceCodeSnapshot: string;
  pieceNameSnapshot: string;
  resourceIdSnapshot: string | null;
  resourceNameSnapshot: string | null;
  sortOrder: number;
};

export class DrizzleInspectionRepository {
  constructor(readonly db: Database) {}

  async findByMutation(clientMutationId: string): Promise<InspectionDetail | null> {
    const [row] = await this.db.select({ id: yearEndLegInspections.id })
      .from(yearEndLegInspections)
      .where(eq(yearEndLegInspections.clientMutationId, clientMutationId))
      .limit(1);
    return row ? this.get(row.id) : null;
  }

  async getForLegYear(legId: string, inspectionYear: number): Promise<InspectionDetail | null> {
    const [row] = await this.db.select({ id: yearEndLegInspections.id })
      .from(yearEndLegInspections)
      .where(and(
        eq(yearEndLegInspections.legId, legId),
        eq(yearEndLegInspections.inspectionYear, inspectionYear),
        isNull(yearEndLegInspections.archivedAt),
      ))
      .limit(1);
    return row ? this.get(row.id) : null;
  }

  async list(): Promise<InspectionDetail[]> {
    const rows = await this.db.select({ id: yearEndLegInspections.id })
      .from(yearEndLegInspections)
      .where(isNull(yearEndLegInspections.archivedAt))
      .orderBy(asc(yearEndLegInspections.legId), asc(yearEndLegInspections.inspectionYear));
    return (await Promise.all(rows.map((row: { id: string }) => this.get(row.id))))
      .filter((row): row is InspectionDetail => Boolean(row));
  }

  async currentPieceSeeds(legId: string): Promise<EntrySeed[]> {
    const rows = await this.db.select({
      pieceId: equipmentPieces.id,
      pieceCodeSnapshot: equipmentPieces.code,
      pieceNameSnapshot: equipmentPieces.name,
      resourceIdSnapshot: equipmentPieceAssignments.resourceId,
      resourceNameSnapshot: resources.name,
    }).from(equipmentPieces)
      .leftJoin(equipmentPieceAssignments, and(
        eq(equipmentPieceAssignments.pieceId, equipmentPieces.id),
        isNull(equipmentPieceAssignments.removedAt),
      ))
      .leftJoin(resources, eq(resources.id, equipmentPieceAssignments.resourceId))
      .where(and(eq(equipmentPieces.currentLegId, legId), isNull(equipmentPieces.archivedAt)))
      .orderBy(asc(equipmentPieces.code));
    return rows.map((row: Omit<EntrySeed, "clientMutationId" | "sortOrder">, index: number) => ({
      ...row,
      clientMutationId: crypto.randomUUID(),
      sortOrder: index,
    }));
  }

  async create(input: NewInspection, seeds: EntrySeed[]): Promise<string> {
    return this.db.transaction(async (tx: Database) => {
      const [inspection] = await tx.insert(yearEndLegInspections).values({
        id: input.id,
        clientMutationId: input.clientMutationId,
        legId: input.legId,
        inspectionYear: input.inspectionYear,
        copiedFromInspectionId: input.copiedFromInspectionId ?? null,
        managerIdentitySnapshot: input.managerIdentitySnapshot,
        status: seeds.length ? "in_progress" : "draft",
        startedAt: new Date(),
      }).returning({ id: yearEndLegInspections.id });
      if (!inspection) throw new Error("INSPECTION_CREATE_FAILED");
      if (seeds.length) {
        await tx.insert(yearEndInspectionEntries).values(seeds.map((seed) => ({
          ...seed,
          inspectionId: inspection.id,
        })));
      }
      await tx.insert(yearEndInspectionAuditEvents).values({
        inspectionId: inspection.id,
        pieceId: null,
        action: input.copiedFromInspectionId ? "inspection_copied" : "inspection_started",
        actorId: input.managerIdentitySnapshot,
        payload: { entryCount: seeds.length, copiedFromInspectionId: input.copiedFromInspectionId ?? null },
      });
      return inspection.id;
    });
  }

  async get(id: string): Promise<InspectionDetail | null> {
    const [inspection] = await this.db.select().from(yearEndLegInspections)
      .where(eq(yearEndLegInspections.id, id)).limit(1);
    if (!inspection) return null;
    const rows = await this.db.select({
      entry: yearEndInspectionEntries,
      maintenance: yearEndInspectionMaintenanceItems,
    }).from(yearEndInspectionEntries)
      .leftJoin(yearEndInspectionMaintenanceItems, eq(yearEndInspectionMaintenanceItems.entryId, yearEndInspectionEntries.id))
      .where(eq(yearEndInspectionEntries.inspectionId, id))
      .orderBy(asc(yearEndInspectionEntries.sortOrder));
    const entries = rows.map((row: { entry: Omit<InspectionEntryRecord, "maintenanceItem">; maintenance: InspectionMaintenanceItem | null }) => ({
      ...row.entry,
      maintenanceItem: row.maintenance,
    })) as InspectionEntryRecord[];
    return { ...inspection, entries, progress: calculateInspectionProgress(entries) } as InspectionDetail;
  }

  async getEntry(id: string): Promise<InspectionEntryRecord | null> {
    const [row] = await this.db.select({
      entry: yearEndInspectionEntries,
      maintenance: yearEndInspectionMaintenanceItems,
    }).from(yearEndInspectionEntries)
      .leftJoin(yearEndInspectionMaintenanceItems, eq(yearEndInspectionMaintenanceItems.entryId, yearEndInspectionEntries.id))
      .where(eq(yearEndInspectionEntries.id, id)).limit(1);
    return row ? { ...row.entry, maintenanceItem: row.maintenance } as InspectionEntryRecord : null;
  }

  async patchEntry(id: string, patch: InspectionEntryUpdate, actorId: string): Promise<InspectionEntryRecord | null> {
    const updatedId = await this.db.transaction(async (tx: Database) => {
      const [existing] = await tx.select().from(yearEndInspectionEntries)
        .where(eq(yearEndInspectionEntries.id, id)).limit(1);
      if (!existing) return null;

      const { pieceCodeSnapshot, pieceNameSnapshot, resourceAssignment, ...inspectionPatch } = patch;
      const nextCode = pieceCodeSnapshot?.trim() ?? existing.pieceCodeSnapshot;
      const nextName = pieceNameSnapshot?.trim() ?? existing.pieceNameSnapshot;
      const codeChanged = pieceCodeSnapshot !== undefined && nextCode !== existing.pieceCodeSnapshot;
      const nameChanged = pieceNameSnapshot !== undefined && nextName !== existing.pieceNameSnapshot;
      const identityPatch = {
        ...(codeChanged ? { pieceCodeSnapshot: nextCode } : {}),
        ...(nameChanged ? { pieceNameSnapshot: nextName } : {}),
      };
      let resourceSnapshotPatch: { resourceIdSnapshot?: string | null; resourceNameSnapshot?: string | null } = {};
      if (resourceAssignment) {
        const [inspection] = await tx.select({ legId: yearEndLegInspections.legId })
          .from(yearEndLegInspections)
          .where(eq(yearEndLegInspections.id, existing.inspectionId))
          .limit(1);
        if (!inspection) throw new Error("INSPECTION_NOT_FOUND");

        let nextResource: { id: string; name: string } | null = null;
        if (resourceAssignment.mode !== "none") {
          const [found] = await tx.select({
            id: resources.id,
            name: resources.name,
            status: resources.status,
            normalTravelLegId: resources.normalTravelLegId,
          }).from(resources).where(eq(resources.id, resourceAssignment.resourceId)).limit(1);
          if (found) {
            if (found.status === "archived") throw new Error("PIECE_RESOURCE_UNAVAILABLE");
            if (found.normalTravelLegId !== inspection.legId) throw new Error("PIECE_RESOURCE_OUTSIDE_LEG");
            nextResource = { id: found.id, name: found.name };
          } else if (resourceAssignment.mode === "new") {
            const [created] = await tx.insert(resources).values({
              id: resourceAssignment.resourceId,
              code: `inspection_${resourceAssignment.resourceId.replace(/-/g, "").slice(0, 12)}`,
              name: resourceAssignment.name.trim(),
              category: "Inflatable attraction",
              countsAsAttraction: true,
              normalTravelLegId: inspection.legId,
              status: "available",
            }).returning({ id: resources.id, name: resources.name });
            if (!created) throw new Error("RESOURCE_CREATE_FAILED");
            nextResource = created;
          } else {
            throw new Error("PIECE_RESOURCE_UNAVAILABLE");
          }
        }

        const [currentAssignment] = await tx.select({ resourceId: equipmentPieceAssignments.resourceId })
          .from(equipmentPieceAssignments)
          .where(and(eq(equipmentPieceAssignments.pieceId, existing.pieceId), isNull(equipmentPieceAssignments.removedAt)))
          .limit(1);
        if ((currentAssignment?.resourceId ?? null) !== (nextResource?.id ?? null)) {
          await tx.update(equipmentPieceAssignments).set({ removedAt: new Date() })
            .where(and(eq(equipmentPieceAssignments.pieceId, existing.pieceId), isNull(equipmentPieceAssignments.removedAt)));
          if (nextResource) {
            await tx.insert(equipmentPieceAssignments).values({
              pieceId: existing.pieceId,
              resourceId: nextResource.id,
              actorId,
              reason: "Assigned during year-end inspection",
            });
          }
          await tx.insert(yearEndInspectionAuditEvents).values({
            inspectionId: existing.inspectionId,
            pieceId: existing.pieceId,
            action: nextResource ? "piece_regrouped" : "piece_unassigned",
            actorId,
            payload: { previousResourceId: currentAssignment?.resourceId ?? null, resourceId: nextResource?.id ?? null },
          });
        }
        resourceSnapshotPatch = {
          resourceIdSnapshot: nextResource?.id ?? null,
          resourceNameSnapshot: nextResource?.name ?? null,
        };
      }
      if (codeChanged || nameChanged) {
        await tx.update(equipmentPieces).set({
          ...(codeChanged ? { code: nextCode } : {}),
          ...(nameChanged ? { name: nextName } : {}),
          updatedAt: new Date(),
        }).where(eq(equipmentPieces.id, existing.pieceId));
        await tx.insert(yearEndInspectionAuditEvents).values({
          inspectionId: existing.inspectionId,
          pieceId: existing.pieceId,
          action: "piece_identity_corrected",
          actorId,
          payload: {
            previousCode: existing.pieceCodeSnapshot,
            previousName: existing.pieceNameSnapshot,
            nextCode,
            nextName,
          },
        });
      }

      const statePatch = inspectionPatch.entryState === "inspected"
        ? { inspectedAt: new Date(), inspectorIdentitySnapshot: actorId }
        : inspectionPatch.entryState === "not_present"
          ? { inspectedAt: new Date(), inspectorIdentitySnapshot: actorId, condition: null }
          : {};
      const [updated] = await tx.update(yearEndInspectionEntries)
        .set({ ...inspectionPatch, ...identityPatch, ...resourceSnapshotPatch, ...statePatch, updatedAt: new Date() })
        .where(eq(yearEndInspectionEntries.id, id))
        .returning({ id: yearEndInspectionEntries.id });
      return updated?.id ?? null;
    });
    return updatedId ? this.getEntry(updatedId) : null;
  }

  async markCompleted(id: string, actorId: string): Promise<void> {
    await this.db.transaction(async (tx: Database) => {
      await tx.update(yearEndLegInspections).set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(yearEndLegInspections.id, id));
      await tx.insert(yearEndInspectionAuditEvents).values({
        inspectionId: id, pieceId: null, action: "inspection_completed", actorId, payload: {},
      });
    });
  }

  async reopen(id: string, actorId: string): Promise<void> {
    await this.db.transaction(async (tx: Database) => {
      await tx.update(yearEndLegInspections).set({
        status: "in_progress",
        completedAt: null,
        updatedAt: new Date(),
      }).where(eq(yearEndLegInspections.id, id));
      await tx.insert(yearEndInspectionAuditEvents).values({
        inspectionId: id, pieceId: null, action: "inspection_reopened", actorId, payload: {},
      });
    });
  }

  async addEntry(inspectionId: string, seed: EntrySeed): Promise<void> {
    await this.db.insert(yearEndInspectionEntries).values({ ...seed, inspectionId });
    await this.db.update(yearEndLegInspections).set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(yearEndLegInspections.id, inspectionId));
  }
}

export function calculateInspectionProgress(entries: InspectionEntryRecord[]) {
  const inspected = entries.filter((entry) => entry.entryState === "inspected").length;
  const notPresent = entries.filter((entry) => entry.entryState === "not_present").length;
  const total = entries.length;
  return {
    total,
    inspected,
    notPresent,
    notStarted: total - inspected - notPresent,
    needsAttention: entries.filter((entry) =>
      ["minor_repair", "major_repair", "replace", "retired"].includes(entry.condition ?? ""),
    ).length,
    percentComplete: total === 0 ? 0 : Math.round(((inspected + notPresent) / total) * 100),
  };
}
