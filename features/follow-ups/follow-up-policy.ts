import type { BookingStatus } from "@/features/bookings/booking-types";

const closedStatuses = new Set<BookingStatus>([
  "declined",
  "cancelled",
  "completed",
]);

export function isActiveStatus(status: BookingStatus): boolean {
  return !closedStatuses.has(status);
}

export function needsFollowUpPlan(
  booking: { status: BookingStatus },
  nextFollowUp: { dueAt: Date; completedAt: Date | null } | null,
  now: Date = new Date(),
): boolean {
  const hasFutureIncompleteAction =
    nextFollowUp !== null &&
    nextFollowUp.completedAt === null &&
    Number.isFinite(nextFollowUp.dueAt.getTime()) &&
    nextFollowUp.dueAt > now;

  return isActiveStatus(booking.status) && !hasFutureIncompleteAction;
}
