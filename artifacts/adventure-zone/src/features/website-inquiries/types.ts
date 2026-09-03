export type WebsiteInquiryStatus =
  | "new"
  | "reviewing"
  | "converted"
  | "archived"
  | "spam";

export type WebsiteInquiryAlertState =
  | "pending"
  | "sending"
  | "sent"
  | "retry"
  | "failed";

export type WebsiteInquiryListItem = {
  id: string;
  referenceCode: string;
  status: WebsiteInquiryStatus;
  name: string;
  email: string;
  eventName: string;
  eventDate: string | null;
  eventLocation: string | null;
  packageInterest: string | null;
  reviewedByKind: "owner" | "office" | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  convertedContactId: string | null;
  convertedOrganizationId: string | null;
  convertedBookingId: string | null;
  convertedAt: string | null;
  alertState: WebsiteInquiryAlertState;
  alertAttemptCount: number;
  alertLastAttemptAt: string | null;
  alertFailureReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WebsiteInquiryRecord = WebsiteInquiryListItem & {
  submissionId: string;
  message: string;
  pageUrl: string;
  sourceOrigin: string;
  alertDeliveredRecipients: string[];
};

export type WebsiteInquiryAuditEntry = {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  createdAt: string;
};

export type WebsiteInquiryDetailResponse = {
  inquiry: WebsiteInquiryRecord;
  auditHistory: WebsiteInquiryAuditEntry[];
};

export type WebsiteInquiryMatchCandidate = {
  id: string;
  label: string;
  score: number;
  reasons: string[];
  context: Record<string, string | null>;
};

export type WebsiteInquiryMatches = {
  contacts: WebsiteInquiryMatchCandidate[];
  organizations: WebsiteInquiryMatchCandidate[];
  parsedLocation: { city: string; region: string } | null;
};

export type WebsiteInquiryConversionInput = {
  contact:
    | { mode: "existing"; id: string }
    | { mode: "create"; firstName: string; lastName: string; email?: string };
  organization:
    | { mode: "existing"; id: string }
    | { mode: "create"; name: string; city?: string; region?: string };
  booking: {
    name: string;
    city: string;
    region: string;
    startsAt?: string;
    packageInterest?: string;
    notes?: string;
  };
  nextAction: { kind: "call"; dueAt?: string };
};

export type WebsiteInquiryConversionResult = {
  inquiryId: string;
  contactId: string;
  organizationId: string;
  bookingId: string;
  followUpId: string;
  alreadyConverted: boolean;
};
