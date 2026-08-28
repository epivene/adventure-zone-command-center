import type { BookingStatus } from "@/features/bookings/booking-types";

const qualifiedStatuses = new Set<BookingStatus>([
  "interested",
  "possible",
  "quote_sent",
  "pending_decision",
  "pending_contract",
  "contract_received",
  "confirmed",
]);

export function isQualifiedPotentialStatus(status: string): status is BookingStatus {
  return qualifiedStatuses.has(status as BookingStatus);
}

export function shouldEvaluateLegAssignment(input: {
  previousStatus: string | null;
  nextStatus: string;
  manuallyAssignedLegId: string | null;
}): boolean {
  if (input.manuallyAssignedLegId) return false;
  if (!isQualifiedPotentialStatus(input.nextStatus)) return false;
  if (input.previousStatus === input.nextStatus) return false;
  return true;
}
