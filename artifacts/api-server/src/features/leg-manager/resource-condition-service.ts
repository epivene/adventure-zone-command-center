import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  resourceConditionIssues,
  resources,
} from "@/db/schema";
import type { ChecklistResult } from "@workspace/db/event-checklist-schema";

type Database = NodePgDatabase<typeof schema>;

type ResourceStatus = "available" | "unavailable" | "maintenance" | "archived";

export function resourceStatusEffectForChecklistResult(
  result: ChecklistResult,
  currentStatus: ResourceStatus | null,
): ResourceStatus | null {
  if (currentStatus === null) return null;
  if (result === "unsafe") return "unavailable";
  return currentStatus;
}

export async function applyChecklistConditionEffect(
  database: Database,
  input: {
    checklistResultId: string;
    bookingId: string;
    resourceId: string | null;
    result: "needs_work_safe" | "unsafe";
    summary: string;
    note: string;
  },
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction
      .insert(resourceConditionIssues)
      .values({
        resourceId: input.resourceId,
        bookingId: input.bookingId,
        checklistResultId: input.checklistResultId,
        severity: input.result,
        state: "open",
        summary: input.summary,
        note: input.note.trim(),
      })
      .onConflictDoUpdate({
        target: resourceConditionIssues.checklistResultId,
        set: {
          resourceId: input.resourceId,
          severity: input.result,
          state: "open",
          summary: input.summary,
          note: input.note.trim(),
          resolvedAt: null,
        },
      });

    if (input.result === "unsafe" && input.resourceId) {
      await transaction
        .update(resources)
        .set({ status: "unavailable", updatedAt: new Date() })
        .where(eq(resources.id, input.resourceId));
    }
  });
}
