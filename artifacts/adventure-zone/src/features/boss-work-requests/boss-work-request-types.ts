export type BossWorkRequestType = "rapid_convention_notes" | "email_template_approval" | "convention_planning_questionnaire";
export type BossWorkRequestState =
  | "waiting_on_dave" | "in_progress" | "submitted_to_owner" | "changes_requested"
  | "returned_for_clarification" | "approved" | "applied" | "cancelled";
export type BossWorkRequestPriority = "normal" | "high" | "urgent";

export type BossWorkRequest = {
  id: string;
  type: BossWorkRequestType;
  state: BossWorkRequestState;
  priority: BossWorkRequestPriority;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ConventionNotes = {
  planningAnswers?: Record<string, string>;
  eventName: string;
  organizationName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  eventDate?: string;
  packageInterest?: string[];
  personalDetails?: string;
  nextStep?: string;
  notes?: string;
};

export type ConventionDraft = {
  requestId: string;
  bossAccountId: string;
  clientRevision: number;
  payload: ConventionNotes;
  updatedAt: string;
};

export type ConventionSubmission = {
  id: string;
  requestId: string;
  clientMutationId: string;
  payload: ConventionNotes;
  editVersion: number;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemplateReview = {
  id: string;
  requestId: string;
  templateId: string;
  templateVersion: string | null;
  position: number;
  templateNameSnapshot: string;
  contentFingerprint: string;
  subjectSnapshot: string | null;
  bodySnapshot: string;
  bodyFormatSnapshot: "plain_text" | "html";
  decision: "pending" | "approved" | "changes_requested";
  note: string | null;
  verifiedLinks: { href: string; label: string; verifiedAt: string }[];
  safeLinks: { href: string; label: string }[];
  blockedLinks: {
    href: string;
    label: string;
    reason: "malformed_url" | "unsafe_protocol" | "unresolved_placeholder";
  }[];
};

export type BossWorkRequestDetail = {
  events?: { actorKind: string; newState: string; note: string | null; createdAt: string }[];
  request: BossWorkRequest;
  draft: ConventionDraft | null;
  submissions: ConventionSubmission[];
  templateReviews: TemplateReview[];
  templateReview: TemplateReview | null;
};

export type BossWorkRequestQueue = {
  active: BossWorkRequest[];
  recentlyCompleted: BossWorkRequest[];
};
