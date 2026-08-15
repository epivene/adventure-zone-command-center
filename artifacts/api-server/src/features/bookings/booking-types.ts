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

// The shared Drizzle schema still carries the legacy three-value static type.
// Runtime validation and the database migration support "definite"; this alias
// stays narrow until that generated schema is regenerated without weakening the
// rest of the repository's DB typing.
export type Probability = Exclude<
  (typeof probabilityValues)[number],
  "definite"
>;
