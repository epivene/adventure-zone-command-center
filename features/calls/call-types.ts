import type { BookingEditInput } from "@/features/bookings/booking-input";
import type { BookingStatus } from "@/features/bookings/booking-types";
import type { ContactFields } from "@/features/contacts/contact-types";
import type { callDispositionValues } from "@/db/schema";

export type CallDisposition =
  | "no_answer"
  | "left_voicemail"
  | "follow_up_needed"
  | "interested"
  | "proposal_contract_sent"
  | "booked"
  | "declined"
  | "move_to_last_resort";

export type PersistedCallDisposition = (typeof callDispositionValues)[number];

export type CompleteCallInput = {
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
  note: string;
  disposition: CallDisposition;
  resultingBookingStatus: BookingStatus | null;
  startedAt: Date;
  endedAt: Date;
  nextAction: { kind: string; dueAt: Date } | null;
  lastResortReason: string | null;
  approvedContactUpdates: Partial<ContactFields> | null;
  approvedBookingUpdates: Partial<BookingEditInput> | null;
};

export type CallOrganization = {
  id: string;
  name: string;
  lastResort: boolean;
  lastResortReason: string | null;
};

export type CallContact = {
  id: string;
  organizationId: string | null;
  [key: string]: unknown;
};

export type CallBooking = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  status: BookingStatus;
  [key: string]: unknown;
};

export type CallFollowUp = {
  id: string;
  bookingId: string | null;
  organizationId: string | null;
  contactId: string | null;
  completedAt: Date | null;
  outcome: string | null;
  nextFollowUpId: string | null;
};

export type CallContext = {
  organization: CallOrganization | null;
  contact: CallContact | null;
  booking: CallBooking | null;
  followUp: CallFollowUp | null;
};

export type CompletedCall = {
  activityId: string;
  callSessionId: string;
  nextFollowUpId: string | null;
  disposition: CallDisposition;
  resultingBookingStatus: BookingStatus | null;
};

export type CallError =
  | { code: "INVALID_CALL_INPUT"; message: string }
  | { code: "ORGANIZATION_NOT_FOUND" }
  | { code: "CONTACT_NOT_FOUND" }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "FOLLOW_UP_BOOKING_MISMATCH" }
  | { code: "CONTACT_ORGANIZATION_MISMATCH" }
  | { code: "BOOKING_ORGANIZATION_MISMATCH" }
  | { code: "FOLLOW_UP_ORGANIZATION_MISMATCH" }
  | { code: "FOLLOW_UP_CONTACT_MISMATCH" }
  | { code: "ALREADY_COMPLETED" }
  | { code: "NEXT_ACTION_REQUIRED" }
  | { code: "RESULTING_STATUS_MISMATCH" };

/** Maps the public call interface to the pre-existing database enum. */
export const persistedCallDisposition: Record<
  CallDisposition,
  PersistedCallDisposition
> = {
  no_answer: "no_answer",
  left_voicemail: "left_voicemail",
  follow_up_needed: "follow_up_needed",
  interested: "interested",
  proposal_contract_sent: "proposal_sent",
  booked: "booked",
  declined: "declined",
  move_to_last_resort: "last_resort",
};

export const dispositionBookingStatus: Partial<
  Record<CallDisposition, BookingStatus>
> = {
  interested: "interested",
  proposal_contract_sent: "pending_contract",
  booked: "confirmed",
  declined: "declined",
  move_to_last_resort: "declined",
};
