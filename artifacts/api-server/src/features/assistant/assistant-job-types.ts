export type AssistantJobStatus =
  | "queued"
  | "running"
  | "stopping"
  | "stopped"
  | "complete"
  | "failed";

export type WebsiteAuditStatus =
  | "verified_match"
  | "reachable_uncertain"
  | "likely_mismatch"
  | "broken"
  | "redirected"
  | "replacement_found"
  | "needs_review";

export type AssistantConfidence = "high" | "medium" | "low";

export type AssistantJobProgress = {
  total: number;
  processed: number;
  verified: number;
  broken: number;
  mismatches: number;
  review: number;
  proposedFixes: number;
  cursorAfterId: string | null;
};

export type WebsiteAuditFindingView = {
  id: string;
  recordId: string;
  recordLabel: string;
  savedUrl: string;
  finalUrl: string | null;
  status: WebsiteAuditStatus;
  confidence: AssistantConfidence;
  reasons: string[];
  suggestedUrl: string | null;
  sourceRefs: string[];
};

export type AssistantChangeProposalStatus =
  | "proposed"
  | "approved"
  | "applied"
  | "rejected"
  | "failed";

export type AssistantChangeProposalView = {
  id: string;
  recordId: string;
  field: "website";
  oldValue: string | null;
  newValue: string | null;
  confidence: AssistantConfidence;
  reasons: string[];
  status: AssistantChangeProposalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  failureMessage: string | null;
};

export type AssistantJobView = {
  id: string;
  capability: "website_verification";
  originalInstruction: string;
  normalizedCommand: Record<string, unknown>;
  status: AssistantJobStatus;
  stage: string;
  progress: AssistantJobProgress;
  findings: WebsiteAuditFindingView[];
  proposals: AssistantChangeProposalView[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  failureMessage: string | null;
};

export type AssistantJobClaim = {
  jobId: string;
  actorId: string;
  capability: "website_verification";
  normalizedCommand: Record<string, unknown>;
  status: AssistantJobStatus;
  stage: string;
  workerId: string;
  leaseExpiresAt: string;
};

export type WebsiteAuditFindingInput = Omit<WebsiteAuditFindingView, "id">;

export type AssistantChangeProposalInput = {
  recordId: string;
  field: "website";
  oldValue: string | null;
  newValue: string | null;
  confidence: AssistantConfidence;
  reasons: string[];
};
