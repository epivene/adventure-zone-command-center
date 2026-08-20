import { inArray } from "drizzle-orm";

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
  const ids = items.map((item) => item.id);
  const rows = await database
    .select({
      id: activities.id,
      dateIsImportFallback: activities.dateIsImportFallback,
      occurredAt: activities.occurredAt,
    })
    .from(activities)
    .where(inArray(activities.id, ids));
  const paperRows = rows.filter((row) => {
    const item = items.find((candidate) => candidate.id === row.id);
    return Boolean(item?.body.startsWith("Imported from paper notes"));
  });
  return decoratePaperNoteTimeline(items, paperRows);
}

export async function isPaperNoteActivity(
  database: DrizzleDatabase,
  activityId: string,
): Promise<boolean> {
  const [row] = await database
    .select({ sourceType: activities.sourceType, body: activities.body })
    .from(activities)
    .where(inArray(activities.id, [activityId]))
    .limit(1);
  return row?.sourceType === "paper_note" || row?.body.startsWith("Imported from paper notes") === true;
}
