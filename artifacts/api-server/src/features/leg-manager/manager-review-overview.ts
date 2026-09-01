import { isEventReviewDue } from "./event-review-service";

export type ManagerReviewEvent = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string | null;
};

export type ManagerReviewRecord = {
  id: string;
  bookingId: string;
  rating: number;
  feedback: string | null;
  organizerSiteNotes: string | null;
  crewNotes: string | null;
  recommendReturn: string | null;
  createdAt: Date;
};

export type CompletedManagerReview = {
  event: ManagerReviewEvent;
  review: ManagerReviewRecord;
};

export type ManagerReviewOverview = {
  reviewsDue: ManagerReviewEvent[];
  recentCompleted: CompletedManagerReview | null;
  nextUpcoming: ManagerReviewEvent | null;
};

function eventTime(event: ManagerReviewEvent): number {
  return (event.startsAt ?? event.endsAt)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function dueTime(event: ManagerReviewEvent): number {
  return (event.endsAt ?? event.startsAt)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function isCancelled(event: ManagerReviewEvent): boolean {
  return event.status === "cancelled" || event.status === "declined";
}

export function buildManagerReviewOverview(input: {
  bookings: readonly ManagerReviewEvent[];
  reviews: readonly ManagerReviewRecord[];
  dismissedBookingIds?: ReadonlySet<string>;
  now?: Date;
}): ManagerReviewOverview {
  const now = input.now ?? new Date();
  const dismissedBookingIds = input.dismissedBookingIds ?? new Set<string>();
  const bookingById = new Map(input.bookings.map((event) => [event.id, event]));

  const latestReviewByBooking = new Map<string, ManagerReviewRecord>();
  for (const review of [...input.reviews].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )) {
    if (!latestReviewByBooking.has(review.bookingId)) {
      latestReviewByBooking.set(review.bookingId, review);
    }
  }

  const completed = [...latestReviewByBooking.values()]
    .map((review): CompletedManagerReview | null => {
      const event = bookingById.get(review.bookingId);
      return event ? { event, review } : null;
    })
    .filter((item): item is CompletedManagerReview => item !== null)
    .sort((left, right) => right.review.createdAt.getTime() - left.review.createdAt.getTime());

  const unreviewed = input.bookings.filter(
    (event) => !latestReviewByBooking.has(event.id) && !dismissedBookingIds.has(event.id),
  );

  const reviewsDue = unreviewed
    .filter((event) => !isCancelled(event) && isEventReviewDue(event, now))
    .sort((left, right) => dueTime(right) - dueTime(left));

  const nextUpcoming = unreviewed
    .filter(
      (event) =>
        !isCancelled(event) &&
        (event.startsAt ?? event.endsAt) !== null &&
        !isEventReviewDue(event, now),
    )
    .sort((left, right) => eventTime(left) - eventTime(right))[0] ?? null;

  return {
    reviewsDue,
    recentCompleted: completed[0] ?? null,
    nextUpcoming,
  };
}
