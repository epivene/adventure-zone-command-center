import { eq } from "drizzle-orm";
import {
  yearEndInspectionEntries,
  yearEndInspectionMaintenanceItems,
} from "@workspace/db";

type Database = any;

export class YearEndMaintenanceProjection {
  constructor(private readonly db: Database) {}

  async syncForEntry(entryId: string, actorId: string): Promise<void> {
    const [entry] = await this.db.select().from(yearEndInspectionEntries)
      .where(eq(yearEndInspectionEntries.id, entryId)).limit(1);
    if (!entry) throw new Error("INSPECTION_ENTRY_NOT_FOUND");
    const needsItem = entry.repairNeeded || ["minor_repair", "major_repair", "replace", "retired"].includes(entry.condition ?? "");
    if (!needsItem) return;
    await this.db.insert(yearEndInspectionMaintenanceItems).values({
      entryId,
      state: "open",
      followUpNotes: entry.repairNotes,
      createdBy: actorId,
    }).onConflictDoUpdate({
      target: yearEndInspectionMaintenanceItems.entryId,
      set: { followUpNotes: entry.repairNotes },
    });
  }

  async resolve(itemId: string, input: { resolutionNotes: string }, actorId: string): Promise<void> {
    const notes = input.resolutionNotes.trim();
    if (!notes) throw new Error("REPAIR_RESOLUTION_NOTES_REQUIRED");
    const [updated] = await this.db.update(yearEndInspectionMaintenanceItems).set({
      state: "resolved",
      resolutionNotes: notes,
      resolvedAt: new Date(),
      resolvedBy: actorId,
    }).where(eq(yearEndInspectionMaintenanceItems.id, itemId))
      .returning({ id: yearEndInspectionMaintenanceItems.id });
    if (!updated) throw new Error("MAINTENANCE_ITEM_NOT_FOUND");
  }
}
