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
): boolean {
  return isActiveStatus(booking.status) && (!nextFollowUp || nextFollowUp.completedAt !== null);
}
