export type CallerMatchReason =
  | "Exact phone"
  | "Exact email"
  | "Name"
  | "Organization or event"
  | "Due today"
  | "Recently contacted"
  | "Location"
  | "Route leg"
  | "Phone number"
  | "Same area code"
  | "Note text";

export type CallerFinderCandidate = {
  contactId: string;
  name: string;
  email: string | null;
  normalizedPhones: string[];
  organizationName: string | null;
  city: string | null;
  region: string | null;
  bookingName: string | null;
  bookingStatus: string | null;
  routeLegName: string | null;
  lastContactedAt: Date | null;
  dueToday: boolean;
  noteText: string | null;
  matchedOrganizationOrEvent: boolean;
  matchedLocation: boolean;
  matchedContactPostalCode: boolean;
  matchedRouteLeg: boolean;
};

export type CallerSuggestion = {
  contactId: string;
  name: string;
  organizationName: string | null;
  city: string | null;
  region: string | null;
  bookingStatus: string | null;
  routeLegName: string | null;
  lastContactedAt: Date | null;
  reasons: CallerMatchReason[];
  score: number;
  noteSnippet?: string;
};

export type CallerFinderResult = {
  exact: { kind: "one"; contactId: string } | { kind: "none" };
  suggestions: CallerSuggestion[];
  canCreate: boolean;
};

export type DuplicateReason =
  | "Exact phone"
  | "Exact email"
  | "Name and organization"
  | "Name and location";

export type DuplicateCandidate = {
  contactId: string;
  name: string;
  organizationName: string | null;
  city: string | null;
  region: string | null;
  reasons: DuplicateReason[];
  kind: "exact" | "likely";
};
