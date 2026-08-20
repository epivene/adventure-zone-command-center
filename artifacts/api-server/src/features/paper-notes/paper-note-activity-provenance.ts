import { and, eq, inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { activities } from "@/db/schema";
import type { ActivityTimelineItem } from "@/features/activities/activity-types";

type DrizzleDatabase = typeof database;

export type PaperNoteActivityProvenanceRow = {
  id: string;
  dateIsImportFallback: boolean;
  occurredAt: Date | null;
};

export function decoratePaperNoteTimeline(
  items: ActivityTimelineItem[],
  paperRows: PaperNoteActivityProvenanceRow[],
): ActivityTimelineItem[] {
  const byId = new Map(paperRows.map((row) => [row.id, row]));
  return items.map((item) => {
    const paper = byId.get(item.id);
    if (!paper) return item;
    return {
      ...item,
      historicalDateUnknown: paper.occurredAt === null && paper.dateIsImportFallback,
      paperNoteSource: { activityId: item.id },
    };
  });
}

export async function enrichPaperNoteTimeline(
  database: DrizzleDatabase,
  items: ActivityTimelineItem[],
): Promise<ActivityTimelineItem[]> {
  if (!items.length) return items;
  const rows = await database
    .select({
      id: activities.id,
      dateIsImportFallback: activities.dateIsImportFallback,
      occurredAt: activities.occurredAt,
    })
    .from(activities)
    .where(and(
      inArray(activities.id, items.map((item) => item.id)),
      eq(activities.sourceType, "paper_note"),
    ));
  return decoratePaperNoteTimeline(items, rows);
}

export async function isPaperNoteActivity(
  database: DrizzleDatabase,
  activityId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ id: activities.id })
    .from(activities)
    .where(and(
      eq(activities.id, activityId),
      eq(activities.sourceType, "paper_note"),
    ))
    .limit(1);
  return Boolean(row);
}
