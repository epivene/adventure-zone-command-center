export type EventFamilyCandidateSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
};

export type EventFamilySuggestion = {
  id: string;
  proposedName: string;
  normalizedName: string;
  candidateIds: string[];
  source: "rule" | "ai";
  confidence: number;
  reason: string;
  status: "pending" | "approved" | "dismissed";
  candidates?: EventFamilyCandidateSummary[];
};

export type EventFamilyListRecord = {
  id: string;
  name: string;
  normalizedName: string;
  description: string | null;
  memberCount: number;
};

export type EventFamilyMember = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  placeType: string | null;
  contactCount: number;
  bookingCount: number;
  nextFollowUpAt: string | null;
};

export type EventFamilyContact = {
  id: string;
  contactId: string;
  name: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  isPrimary: boolean;
};

export type EventFamilyDetail = EventFamilyListRecord & {
  website: string | null;
  contacts: EventFamilyContact[];
  members: EventFamilyMember[];
};
