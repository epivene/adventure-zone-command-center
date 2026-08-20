export type PaperNoteReviewedPhone = {
  key: string;
  number: string;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  status: "active" | "questionable" | "inactive";
  primary: boolean;
  crossedOut: boolean;
  importAsStructuredValue: boolean;
};

export type PaperNoteReviewedContact = {
  key: string;
  mode: "existing_contact" | "new_contact" | "note_only";
  selectedContactId: string | null;
  name: string;
  role: string | null;
  email: string | null;
  primary: boolean;
  phones: PaperNoteReviewedPhone[];
};

export type PaperNoteDestinationChoice =
  | { mode: "existing_profile"; organizationId: string; organizationLocationId: string | null }
  | { mode: "existing_profile_new_location"; organizationId: string; newLocation: { label: string; venueName: string | null; address1: string | null; address2: string | null; city: string | null; region: string | null; postalCode: string | null } }
  | { mode: "new_profile"; eventFamilyId: string | null }
  | { mode: "skip" };

export type PaperNoteReviewDraft = {
  event: {
    name: string;
    city: string;
    region: string;
    venue: string;
    eventDateText: string;
    startsOn: string | null;
    endsOn: string | null;
    pageYearConfirmed: boolean;
  };
  activity: {
    occurredOn: string | null;
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string;
    summary: string;
  };
  contacts: PaperNoteReviewedContact[];
  organizationPhones: PaperNoteReviewedPhone[];
  oldReminder: string;
  starredOnPaper: boolean;
  generalNotes: string[];
  destination: PaperNoteDestinationChoice | null;
  conflicts: Record<string, unknown>;
  currentFollowUp: {
    enabled: boolean;
    kind: string;
    dueOn: string | null;
    contactKey: string | null;
  };
};

export type PaperNoteReviewEntryDetails = {
  id: string;
  review: PaperNoteReviewDraft;
  reviewVersion: number;
  state: "needs_review" | "ready" | "approved" | "skipped" | "imported";
  validationIssues: Array<{ fieldPath: string; message: string; severity: "warning" | "blocking" }>;
  approvedAt: string | null;
  extraction: {
    transcription: string;
    sourceRegion?: { x: number; y: number; width: number; height: number } | null;
    warnings?: Array<{ fieldPath: string; message: string; severity: "warning" | "blocking" }>;
  };
};

export type PaperNoteSavedPhone = {
  id: string;
  organizationLocationId?: string | null;
  number: string;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  status: "active" | "questionable" | "inactive";
  primary: boolean;
};

export type PaperNoteSavedContact = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phones: PaperNoteSavedPhone[];
};

export type PaperNoteMatch = {
  organizationId: string;
  organizationLocationId: string | null;
  name: string;
  city: string | null;
  region: string | null;
  strength: "strong" | "possible";
  score: number;
  reasons: string[];
  contacts: PaperNoteSavedContact[];
  organizationPhones: PaperNoteSavedPhone[];
};
