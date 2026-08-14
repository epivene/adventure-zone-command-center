export type ArchiveProfileSource = {
  sourceRecordId: string;
  sourceVersionId: string;
  streamType: "company" | "contact";
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
};

export type ProfileCandidate = {
  id: string;
  entityType: "organization" | "contact";
  exactSignals: Array<
    "source_link" | "email" | "phone_and_name" | "company_name_and_location"
  >;
  values: Record<string, string | null>;
};

export type ArchiveProfileAiProjection = {
  sourceRecordId: string;
  streamType: "company" | "contact";
  supportedFields: Record<string, string | null>;
  contextLabels: string[];
};

export type ArchiveProfileResolutionProvenance = {
  resolutionPolicyVersion: string;
  aiProvider: string | null;
  aiConfidence: "high" | "medium" | "low" | null;
};

type ResolutionProvenance = {
  provenance?: ArchiveProfileResolutionProvenance;
};

export type ArchiveProfileResolution =
  | (ResolutionProvenance & {
      action: "already_imported";
      targetEntityType: "organization" | "contact";
      targetEntityId: string;
      values: Record<string, string | null>;
      evidenceLabels: string[];
    })
  | (ResolutionProvenance & {
      action: "link_existing" | "update_existing";
      targetEntityType: "organization" | "contact";
      targetEntityId: string;
      values: Record<string, string | null>;
      evidenceLabels: string[];
    })
  | (ResolutionProvenance & {
      action: "create_profile";
      targetEntityType: "organization" | "contact";
      values: Record<string, string | null>;
      evidenceLabels: string[];
    })
  | (ResolutionProvenance & {
      action: "needs_ai";
      projection: ArchiveProfileAiProjection;
      evidenceLabels: string[];
    })
  | (ResolutionProvenance & {
      action: "retry_later";
      reasonCode: "ai_unavailable" | "ai_timeout";
      evidenceLabels: string[];
    })
  | (ResolutionProvenance & {
      action: "preserve";
      reasonCode:
        | "invalid_source_record"
        | "missing_act_record_id"
        | "missing_required_identity"
        | "ai_low_confidence"
        | "ai_invalid_response";
      evidenceLabels: string[];
    });

export type ArchiveProfileSourceContext = {
  source: ArchiveProfileSource;
  candidates: readonly ProfileCandidate[];
  linkedTarget: ProfileCandidate | null;
};

export type ArchiveProfileImportStatus = {
  jobId: string;
  runId: string;
  phase: "companies" | "contacts" | "complete" | "failed";
  active: boolean;
  eligibleCount: number;
  processedCount: number;
  createdCount: number;
  linkedCount: number;
  updatedCount: number;
  alreadyImportedCount: number;
  preservedCount: number;
  retryableFailureCount: number;
  lastErrorCode: string | null;
};

export type ArchiveProfileBatchCommit = {
  status: ArchiveProfileImportStatus;
  phaseAdvanced: boolean;
};
