import type {
  BookingOperationsSummary,
  BookingOperationsSummaryProvider,
} from "@/features/bookings/booking-operations-summary";
import type { BookingStatus } from "@/features/bookings/booking-types";
import type { ContactPhoneRecord } from "@/features/contact-phones/contact-phone-repository";
import {
  loadCallWorkspaceContext,
  type CallWorkspaceContext,
  type CallWorkspaceContextRepository,
  type CallWorkspaceQuery,
} from "@/features/calls/call-workspace-context";
import {
  callScriptPrompts,
  selectCallScript,
} from "@/features/calls/call-script";
import type { CallScriptKind } from "@/features/calls/call-types";

export type CallWorkspacePhoneRepository = {
  listForContact(contactId: string): Promise<ContactPhoneRecord[]>;
};

export type CallWorkspaceContextSummary = {
  bookingStatus: BookingStatus | null;
  bookingStatusLabel: string | null;
  travelLeg: { id: string; name: string; color: string } | null;
  lastContactedAt: Date | null;
};

export type LoadedCallWorkspace = {
  context: CallWorkspaceContext;
  operations: BookingOperationsSummary | null;
  phones: ContactPhoneRecord[];
  contextSummary: CallWorkspaceContextSummary;
  defaultScriptKind: CallScriptKind;
  scriptPrompts: string[];
};

function bookingStatusLabel(status: BookingStatus | null) {
  return status
    ? status.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ")
    : null;
}

export async function loadCallWorkspace(
  query: CallWorkspaceQuery,
  repository: CallWorkspaceContextRepository,
  phoneRepository: CallWorkspacePhoneRepository,
  operationsProvider: BookingOperationsSummaryProvider,
): Promise<{ ok: true; value: LoadedCallWorkspace } | { ok: false }> {
  const context = await loadCallWorkspaceContext(query, repository);
  if (!context.ok) return context;
  const [operations, phones, lastContactedAt] = await Promise.all([
    context.value.booking
      ? operationsProvider.getForBooking(context.value.booking.id)
      : Promise.resolve(null),
    context.value.contact
      ? phoneRepository.listForContact(context.value.contact.id)
      : Promise.resolve([]),
    repository.findLastContactedAt(context.value),
  ]);
  const bookingStatus = context.value.booking?.status ?? null;
  const defaultScriptKind = selectCallScript({
    direction: "outgoing",
    followUpKind: context.value.followUp?.kind ?? null,
    bookingStatus,
  });
  return {
    ok: true,
    value: {
      context: context.value,
      operations,
      phones,
      contextSummary: {
        bookingStatus,
        bookingStatusLabel: bookingStatusLabel(bookingStatus),
        travelLeg: operations?.leg ?? null,
        lastContactedAt,
      },
      defaultScriptKind,
      scriptPrompts: [...callScriptPrompts[defaultScriptKind]],
    },
  };
}
