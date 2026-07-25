import type { BookingStatus } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";
import { isFutureBusinessDate } from "@/lib/business-date";

export function bookingEditPreservesFollowUpPlan(
  resultingStatus: BookingStatus,
  followUps: readonly { dueAt: Date; completedAt: Date | null }[],
  now: Date,
): boolean {
  if (!isActiveStatus(resultingStatus)) return true;
  return followUps.some(
    (followUp) =>
      followUp.completedAt === null &&
      isFutureBusinessDate(followUp.dueAt, now),
  );
}
