import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { activities, bookings, followUps } from "@/db/schema";

const CLEAR_PREFIX = "__today_next_step_clear__:";
const REOPEN_PREFIX = "__today_next_step_reopen__:";

const meaningfulKinds = [
  "call",
  "note",
  "follow_up",
  "status_change",
  "booking_update",
  "contract_update",
  "approved_suggestion",
] as const;

type DrizzleDatabase = typeof database;
type NextStepItem = { id: string };

function uniqueBookingIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, 100);
}

export function parseTodayNextStepBookingIds(values: unknown): string[] {
  return uniqueBookingIds(values);
}

export async function clearTodayNextSteps(
  db: DrizzleDatabase,
  bookingIds: string[],
  reason: string,
): Promise<void> {
  if (!bookingIds.length) return;
  const existing = await db.select({ id: bookings.id }).from(bookings).where(inArray(bookings.id, bookingIds));
  const now = new Date();
  if (!existing.length) return;
  await db.insert(activities).values(existing.map(({ id }) => ({
    bookingId: id,
    kind: "note" as const,
    body: `${CLEAR_PREFIX}${reason || "no_follow_up_needed"}`,
    occurredAt: now,
    timelineSortAt: now,
    createdAt: now,
    updatedAt: now,
  })));
}

export async function reopenTodayNextSteps(
  db: DrizzleDatabase,
  bookingIds: string[],
): Promise<void> {
  if (!bookingIds.length) return;
  const existing = await db.select({ id: bookings.id }).from(bookings).where(inArray(bookings.id, bookingIds));
  const now = new Date();
  if (!existing.length) return;
  await db.insert(activities).values(existing.map(({ id }) => ({
    bookingId: id,
    kind: "note" as const,
    body: `${REOPEN_PREFIX}undo`,
    occurredAt: now,
    timelineSortAt: now,
    createdAt: now,
    updatedAt: now,
  })));
}

export async function snoozeTodayNextSteps(
  db: DrizzleDatabase,
  bookingIds: string[],
  dueAt: Date,
): Promise<void> {
  if (!bookingIds.length || !Number.isFinite(dueAt.getTime())) return;
  const existing = await db.select({ id: bookings.id }).from(bookings).where(inArray(bookings.id, bookingIds));
  const now = new Date();
  if (!existing.length) return;
  await db.insert(followUps).values(existing.map(({ id }) => ({
    bookingId: id,
    kind: "today_next_step_snooze",
    dueAt,
    createdAt: now,
    updatedAt: now,
  })));
}

export async function filterClearedTodayNextSteps<T extends NextStepItem>(
  db: DrizzleDatabase,
  items: T[],
): Promise<T[]> {
  if (!items.length) return items;
  const bookingIds = items.map(({ id }) => id);
  const [activityRows, bookingRows] = await Promise.all([
    db
      .select({ bookingId: activities.bookingId, body: activities.body, occurredAt: activities.occurredAt })
      .from(activities)
      .where(and(
        inArray(activities.bookingId, bookingIds),
        inArray(activities.kind, meaningfulKinds),
        isNull(activities.deletedAt),
      ))
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt)),
    db
      .select({ id: bookings.id, updatedAt: bookings.updatedAt })
      .from(bookings)
      .where(inArray(bookings.id, bookingIds)),
  ]);

  const latestActivity = new Map<string, { body: string; occurredAt: Date | null }>();
  for (const row of activityRows) {
    if (!row.bookingId || latestActivity.has(row.bookingId)) continue;
    latestActivity.set(row.bookingId, { body: row.body, occurredAt: row.occurredAt });
  }
  const bookingUpdatedAt = new Map(bookingRows.map((row) => [row.id, row.updatedAt] as const));

  return items.filter(({ id }) => {
    const latest = latestActivity.get(id);
    if (!latest?.body.startsWith(CLEAR_PREFIX)) return true;
    const clearAt = latest.occurredAt?.getTime() ?? 0;
    const updatedAt = bookingUpdatedAt.get(id)?.getTime() ?? 0;
    return updatedAt > clearAt;
  });
}
