export type ScoutAlertKind =
  | "application_opened"
  | "deadline_approaching"
  | "dates_announced"
  | "dates_changed"
  | "contact_changed"
  | "needs_verification"
  | "monitoring_problem";

export type ScoutAlertSeverity = "info" | "attention" | "urgent";
export type ScoutAlertStatus = "open" | "snoozed" | "dismissed" | "resolved";
export type ScoutAlertWatchStatus = "active" | "paused" | "complete";
export type ScoutAlertConfidence = "high" | "medium" | "low";

export type ScoutAlertSource = {
  url: string;
  title: string;
  publisher: string | null;
  category: string;
  retrievedAt: string;
};

export type ScoutAlertSnapshot = {
  startsAt: string | null;
  endsAt: string | null;
  applicationAvailable: boolean;
  applicationUrl: string | null;
  applicationDeadline: string | null;
  organizerName: string | null;
  organizerEmail: string | null;
  organizerPhone: string | null;
  coverageGaps: string[];
  sources: ScoutAlertSource[];
  capturedAt: string;
};

export type ScoutAlertDraft = {
  kind: ScoutAlertKind;
  severity: ScoutAlertSeverity;
  title: string;
  body: string;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  sources: ScoutAlertSource[];
  confidence: ScoutAlertConfidence | null;
  fingerprint: string;
  dueAt: string | null;
};

export type ScoutAlertView = {
  id: string;
  organizationId: string;
  bookingId: string | null;
  profileName: string;
  kind: ScoutAlertKind;
  severity: ScoutAlertSeverity;
  title: string;
  body: string;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  sources: ScoutAlertSource[];
  confidence: ScoutAlertConfidence | null;
  dueAt: string | null;
  detectedAt: string;
};
