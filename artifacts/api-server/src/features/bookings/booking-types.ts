export const bookingStatusValues = [
  "new_lead",
  "researching",
  "contact_due",
  "contacted",
  "interested",
  "possible",
  "unlikely",
  "quote_sent",
  "pending_decision",
  "pending_contract",
  "contract_received",
  "confirmed",
  "declined",
  "cancelled",
  "completed",
  "renewal_due",
] as const;

export type BookingStatus = (typeof bookingStatusValues)[number];

export const probabilityValues = [
  "definite",
  "likely",
  "possible",
  "unlikely",
] as const;

export type Probability = (typeof probabilityValues)[number];
