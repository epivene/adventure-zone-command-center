import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { bookings, eventManagerReviews } from "@/db/schema";
import { isEventReviewDue } from "./event-review-service";

export type EventReviewInput = {
  bookingId: string;
  rating: number;
  feedback: string | null;
  organizerSiteNotes: string | null;
  crewNotes: string | null;
  recommendReturn: "yes" | "no" | "unsure" | null;
  clientMutationId: string;
};

export type ReviewBooking = {
  id: string;
  travelLegId: string | null;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
};

export interface EventReviewStore {
  listBookingsForLeg(legId: string): Promise<ReviewBooking[]>;
  listReviewsForLeg(legId: string): Promise<any[]>;
  bookingBelongsToLeg(bookingId: string, legId: string): Promise<boolean>;
  findByMutation(legId: string, clientMutationId: string): Promise<any | null>;
  insertReview(input: EventReviewInput & { legId: string }): Promise<any>;
  listReviewsForBooking(bookingId: string): Promise<any[]>;
}

export async function listDueReviewsForManager(
  store: EventReviewStore,
  legId: string,
  now = new Date(),
) {
  const [legBookings, existingReviews] = await Promise.all([
    store.listBookingsForLeg(legId),
    store.listReviewsForLeg(legId),
  ]);
  const reviewed = new Set(existingReviews.map((review) => review.bookingId));
  return legBookings.filter(
    (booking) => !reviewed.has(booking.id) && isEventReviewDue(booking, now),
  );
}

export async function createReviewForManager(
  store: EventReviewStore,
  legId: string,
  input: EventReviewInput,
) {
  const existing = await store.findByMutation(legId, input.clientMutationId);
  if (existing) return { ok: true as const, idempotent: true, review: existing };
  if (!(await store.bookingBelongsToLeg(input.bookingId, legId))) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  return {
    ok: true as const,
    idempotent: false,
    review: await store.insertReview({ ...input, legId }),
  };
}

export async function summarizeReviewHistory(
  store: EventReviewStore,
  bookingId: string,
) {
  const reviews = await store.listReviewsForBooking(bookingId);
  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : null;
  return { reviews, averageRating };
}

export class DrizzleEventReviewRepository implements EventReviewStore {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async listBookingsForLeg(legId: string) {
    return this.database
      .select({
        id: bookings.id,
        travelLegId: bookings.travelLegId,
        name: bookings.name,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
      })
      .from(bookings)
      .where(eq(bookings.travelLegId, legId));
  }

  async listReviewsForLeg(legId: string) {
    return this.database
      .select()
      .from(eventManagerReviews)
      .where(eq(eventManagerReviews.legId, legId))
      .orderBy(desc(eventManagerReviews.createdAt));
  }

  async bookingBelongsToLeg(bookingId: string, legId: string) {
    return Boolean(
      (await this.database
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, bookingId), eq(bookings.travelLegId, legId)))
        .limit(1))[0],
    );
  }

  async findByMutation(legId: string, clientMutationId: string) {
    return (
      await this.database
        .select()
        .from(eventManagerReviews)
        .where(
          and(
            eq(eventManagerReviews.legId, legId),
            eq(eventManagerReviews.clientMutationId, clientMutationId),
          ),
        )
        .limit(1)
    )[0] ?? null;
  }

  async insertReview(input: EventReviewInput & { legId: string }) {
    const rows = await this.database
      .insert(eventManagerReviews)
      .values(input)
      .onConflictDoNothing({
        target: [eventManagerReviews.legId, eventManagerReviews.clientMutationId],
      })
      .returning();
    if (rows[0]) return rows[0];
    const existing = await this.findByMutation(input.legId, input.clientMutationId);
    if (!existing) throw new Error("Review insert conflicted without existing row");
    return existing;
  }

  async listReviewsForBooking(bookingId: string) {
    return this.database
      .select()
      .from(eventManagerReviews)
      .where(eq(eventManagerReviews.bookingId, bookingId))
      .orderBy(desc(eventManagerReviews.createdAt));
  }
}
