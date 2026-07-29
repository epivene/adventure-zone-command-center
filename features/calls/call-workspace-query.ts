import type {
  BookingOperationsSummary,
  BookingOperationsSummaryProvider,
} from "@/features/bookings/booking-operations-summary";
import {
  loadCallWorkspaceContext,
  type CallWorkspaceContext,
  type CallWorkspaceContextRepository,
  type CallWorkspaceQuery,
} from "@/features/calls/call-workspace-context";

export type LoadedCallWorkspace = {
  context: CallWorkspaceContext;
  operations: BookingOperationsSummary | null;
};

export async function loadCallWorkspace(
  query: CallWorkspaceQuery,
  repository: CallWorkspaceContextRepository,
  operationsProvider: BookingOperationsSummaryProvider,
): Promise<{ ok: true; value: LoadedCallWorkspace } | { ok: false }> {
  const context = await loadCallWorkspaceContext(query, repository);
  if (!context.ok) return context;
  const operations = context.value.booking
    ? await operationsProvider.getForBooking(context.value.booking.id)
    : null;
  return { ok: true, value: { context: context.value, operations } };
}
