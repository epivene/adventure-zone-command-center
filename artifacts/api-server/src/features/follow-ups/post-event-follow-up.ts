import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { followUps } from "@/db/schema";

export const POST_EVENT_FOLLOW_UP_KIND = "post_event_email_or_call";

type DrizzleDatabase = typeof database;

/**
 * Ensure an event has exactly one checkout-generated booking follow-up.
 *
 * We intentionally consider completed follow-ups a match too. A retry or later
 * checkout edit should never resurrect a second copy after Booking has already
 * handled the original task.
 */
export async function ensurePostEventFollowUp(
  db: DrizzleDatabase,
  bookingId: string,
  dueAt: Date,
): Promise<{ id: string; created: boolean }> {
  const [existing] = await db
    .select({ id: followUps.id })
    .from(followUps)
    .where(
      and(
        eq(followUps.bookingId, bookingId),
        eq(followUps.kind, POST_EVENT_FOLLOW_UP_KIND),
      ),
    )
    .limit(1);

  if (existing) {
    return { id: existing.id, created: false };
  }

  const now = new Date();
  const [created] = await db
    .insert(followUps)
    .values({
      bookingId,
      kind: POST_EVENT_FOLLOW_UP_KIND,
      dueAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: followUps.id });

  if (!created) {
    throw new Error("Post-event follow-up insert returned no row");
  }

  return { id: created.id, created: true };
}
