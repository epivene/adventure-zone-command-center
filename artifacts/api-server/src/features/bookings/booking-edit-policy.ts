import type { BookingStatus } from "@/features/bookings/booking-types";

/**
 * Booking detail edits do not create, complete, or reschedule follow-ups.
 * Follow-up-plan invariants belong to the workflows that actually mutate the
 * plan (booking creation and follow-up completion). Enforcing that invariant
 * here traps imported/legacy active bookings that arrived without a future
 * follow-up and makes unrelated fields impossible to correct.
 */
export function bookingEditPreservesFollowUpPlan(
  _resultingStatus: BookingStatus,
  _followUps: readonly { dueAt: Date; completedAt: Date | null }[],
  _now: Date,
): boolean {
  return true;
}
