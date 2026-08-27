import type { BookingEditInput } from "@/features/bookings/booking-input";
import type { BookingStatus } from "@/features/bookings/booking-types";
import type { ContactFields } from "@/features/contacts/contact-types";
import type { callDispositionValues } from "@/db/schema";

export type CallDirection = "incoming" | "outgoing";
export type CallMethod = "standard_call" | "office_call" | "individual_voicemail" | "mobile_log";
export type CallScriptKind = "first_outreach" | "follow_up" | "contract_follow_up" | "incoming_inquiry";
export type GuidedCallScriptKind =
  | "first_outreach"
  | "rebooking"
  | "follow_up"
  | "proposal_contract"
  | "callback"
  | "incoming_inquiry";

export type CallBriefing = {
  reason: GuidedCallScriptKind;
  headline: string;
  status: string | null;
  eventName: string | null;
  eventDate: string | null;
  location: string | null;
  routeLeg: string | null;
  packageInterest: string | null;
  lastContactedAt: string | null;
  lastOutcome: string | null;
  keyFacts: string[];
  historySummary: string | null;
};

export type CallDisposition =
  | "no_answer"
  | "left_voicemail"
  | "follow_up_needed"
  | "email_requested"
  | "interested"
  | "proposal_contract_sent"
  | "booked"
  | "declined"
  | "move_to_last_resort"
  | "spoke_with_contact"
  | "wrong_number"
  | "do_not_call";

export type PersistedCallDisposition = (typeof callDispositionValues)[number];

export type CompleteCallInput = {
  requestKey: string;
  organizationId: string | null;
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
  lastResortConfirmed: boolean;
  approvedContactUpdates: Partial<ContactFields> | null;
  approvedBookingUpdates: Partial<BookingEditInput> | null;
  direction: CallDirection;
  method: CallMethod;
  phoneId: string | null;
  scriptKind: CallScriptKind;
  doNotCallConfirmed: boolean;
  doNotCallReason: string | null;
  doNotCallPhoneId: string | null;
  entryMode: "desktop" | "mobile";
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
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
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
  contactHasActiveOrganizationRelationship: boolean | null;
  contactHasBookingRelationship: boolean | null;
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
  | { code: "LAST_RESORT_REQUIRES_ORGANIZATION" }
  | { code: "CONTACT_NOT_FOUND" }
  | { code: "BOOKING_NOT_FOUND" }
  | { code: "FOLLOW_UP_NOT_FOUND" }
  | { code: "FOLLOW_UP_BOOKING_MISMATCH" }
  | { code: "CONTACT_ORGANIZATION_MISMATCH" }
  | { code: "BOOKING_ORGANIZATION_MISMATCH" }
  | { code: "FOLLOW_UP_ORGANIZATION_MISMATCH" }
  | { code: "FOLLOW_UP_CONTACT_MISMATCH" }
  | { code: "CONTACT_BOOKING_MISMATCH" }
  | { code: "ALREADY_COMPLETED" }
  | { code: "NEXT_ACTION_REQUIRED" }
  | { code: "RESULTING_STATUS_MISMATCH" };

export const persistedCallDisposition: Record<
  CallDisposition,
  PersistedCallDisposition
> = {
  no_answer: "no_answer",
  left_voicemail: "left_voicemail",
  follow_up_needed: "follow_up_needed",
  email_requested: "email_requested",
  interested: "interested",
  proposal_contract_sent: "proposal_sent",
  booked: "booked",
  declined: "declined",
  move_to_last_resort: "last_resort",
  spoke_with_contact: "spoke_with_contact",
  wrong_number: "wrong_number",
  do_not_call: "do_not_call",
};

export const publicCallDisposition: Record<
  PersistedCallDisposition,
  CallDisposition
> = {
  no_answer: "no_answer",
  left_voicemail: "left_voicemail",
  follow_up_needed: "follow_up_needed",
  email_requested: "email_requested",
  interested: "interested",
  proposal_sent: "proposal_contract_sent",
  booked: "booked",
  declined: "declined",
  last_resort: "move_to_last_resort",
  spoke_with_contact: "spoke_with_contact",
  wrong_number: "wrong_number",
  do_not_call: "do_not_call",
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
