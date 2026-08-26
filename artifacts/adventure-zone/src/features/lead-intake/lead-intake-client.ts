import { apiGet, apiPost } from "@/lib/auth-token";
import type { ParsedLeadWorkbook } from "@/features/lead-intake/excel-lead-parser";

export type LeadImportBatchSummary = {
  id: string;
  originalFilename: string;
  status: "review" | "archived";
  rowCount: number;
  importedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LeadImportReviewRow = {
  id: string;
  sheetName: string;
  sourceRowNumber: number;
  company: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  industry: string | null;
  warnings: string[];
  state: "needs_review" | "needs_correction" | "verified" | "skipped";
  reviewVersion: number;
  selectedOrganizationId: string | null;
  selectedContactId: string | null;
  contactMode: "existing" | "manual" | "organization_inbox" | null;
  confirmedEventName: string | null;
  confirmedStartDate: string | null;
  confirmedEndDate: string | null;
  confirmedContactName: string | null;
  confirmedContactRole: string | null;
  confirmedRecipientEmail: string | null;
  recipientConfirmed: boolean;
  introductionSuitable: boolean;
  relationshipOutcome?: LeadRelationshipOutcome | null;
  relationshipAnchorAt?: string | null;
  relationshipCutoffDate?: string | null;
  relationshipEvidenceIds?: string[];
  latestOutboundAt?: string | null;
  latestVerifiedResponseAt?: string | null;
  relationshipReviewRequired?: boolean;
  relationshipClassifiedAt?: string | null;
  relationshipClassifiedBy?: string | null;
  territoryStatus?: "open" | "ask_amy_dave" | "closed" | "licensing_issue" | "needs_review";
  fitStatus?: "approved" | "needs_review" | "not_a_fit";
  evidence: Array<{ field: "event_dates" | "recipient_email"; candidateValue: string; sourceKind: string; sourceReference: string; selected: boolean }>;
};

export type LeadRelationshipOutcome =
  | "returning_contact"
  | "reintroduction"
  | "prior_outreach_no_response"
  | "new_introduction"
  | "needs_review";

export type LeadRelationshipClassification = {
  rowId: string;
  reviewVersion: number;
  outcome: LeadRelationshipOutcome;
  cutoffDate: string;
  evidenceIds: string[];
  latestOutboundAt: string | null;
  latestVerifiedResponseAt: string | null;
  reviewRequired: boolean;
};

export type LeadRelationshipEvidenceDetail = {
  evidenceId: string;
  sourceType: "act" | "gmail" | "crm";
  occurredAt: string | null;
  direction: "inbound" | "outbound" | "unknown";
  responseProven: boolean;
  excerpt: string;
  conflicting: boolean;
};

export type LeadProfileOption = { id: string; name: string; city: string | null; region: string | null };
export type LeadContactOption = { id: string; firstName: string; lastName: string; email: string | null; role: string | null; jobTitle: string | null };
export type LeadProfileEvidence = {
  organization: { id: string; name: string; city: string | null; region: string | null; phone: string | null; website: string | null };
  contacts: LeadContactOption[];
  actText: Array<{
    sourceRecordId: string;
    sourceVersionId: string;
    sourcePath: string;
    kind: "description" | "business_card";
    originalText: string;
    emails: string[];
  }>;
  emailCandidates: Array<{ email: string; sourceRecordId: string; sourceVersionId: string; sourcePath: string }>;
};

export type LeadEmailPreview = {
  sourceRowId: string;
  rowVersion: number;
  snapshotVersion: number | null;
  verifiedDateRange: { startDate: string; endDate: string };
  recipient: string;
  profileName: string | null;
  eventName: string;
  relationshipStatus: string | null;
  territoryStatus: string | null;
  fitStatus: string | null;
  templateStatus: "approved" | "unavailable";
  templateVersion: string | null;
  templateSource: string | null;
  calendarEvidence: Array<{ calendarId: string | null; eventId: string | null; conflict: boolean }>;
  calendarConflictSummary: {
    totalConflicts: number;
    totalEvidenceRecords: number;
    displayedEvidenceRecords: number;
    truncated: boolean;
  };
  normalPackageCounts: Array<{ packageKey: string; availableQuantity: number }>;
  readiness: { ready: boolean; blockers: string[] };
  subject: string | null;
  body: string | null;
};
export type LeadGmailDraftLink = {
  id: string; rowId: string; state: "prepared" | "created" | "retryable_error" | "manual_review";
  gmailDraftId: string | null; gmailMessageId: string | null; lastErrorCode: string | null;
};
export type CommunicationBlock = { id: string; targetType: string; active: boolean; organizationId?: string | null; contactId?: string | null; normalizedEmail?: string | null; rowId?: string | null; reason: string; createdAt: string };
export type CommunicationBlockEvent = {
  id: string;
  blockId: string;
  action: "created" | "removed";
  actorId: string;
  reason: string;
  createdAt: string;
};
export type LeadImportBatch = LeadImportBatchSummary & { rows: LeadImportReviewRow[] };

type Api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
};

export function createLeadIntakeClient(api: Api) {
  return {
    async importWorkbook(workbook: ParsedLeadWorkbook) {
      return api.post<{ batchId: string; reused: boolean; rowCount: number }>("/lead-intake/imports", {
        originalFilename: workbook.fileName,
        fileSha256: workbook.fileSha256,
        rows: workbook.rows,
      });
    },
    async listBatches() {
      return (await api.get<{ batches: LeadImportBatchSummary[] }>("/lead-intake/imports")).batches;
    },
    async getBatch(batchId: string) {
      return (await api.get<{ batch: LeadImportBatch }>(`/lead-intake/imports/${batchId}`)).batch;
    },
    async searchProfiles(query: string) {
      const response = await api.get<{ organizations: { records: LeadProfileOption[] } }>(
        `/organizations?q=${encodeURIComponent(query)}&pageSize=10`,
      );
      return response.organizations.records;
    },
    async listProfileContacts(organizationId: string) {
      return (await api.get<{ contacts: LeadContactOption[] }>(`/lead-intake/organizations/${organizationId}/contacts`)).contacts;
    },
    async getProfileEvidence(organizationId: string) {
      return (await api.get<{ evidence: LeadProfileEvidence }>(`/lead-intake/organizations/${organizationId}/evidence`)).evidence;
    },
    async confirmReview(rowId: string, body: unknown) {
      return api.post<{ rowId: string; state: "verified"; reviewVersion: number }>(`/lead-intake/rows/${rowId}/confirm`, body);
    },
    async classifyRelationship(rowId: string, expectedVersion: number) {
      return api.post<LeadRelationshipClassification>(
        `/lead-intake/rows/${rowId}/classify-relationship`,
        { expectedVersion },
      );
    },
    async getRelationshipEvidence(rowId: string) {
      return (await api.get<{ evidence: LeadRelationshipEvidenceDetail[] }>(
        `/lead-intake/rows/${rowId}/relationship-evidence`,
      )).evidence;
    },
    async updateReviewStatus(rowId: string, body: { expectedVersion: number; territoryStatus: string; fitStatus: string }) {
      return api.post<{ rowId: string; reviewVersion: number; territoryStatus: string; fitStatus: string }>(`/lead-intake/rows/${rowId}/review-status`, body);
    },
    async getEmailPreview(rowId: string, expectedVersion: number) {
      return (await api.get<{ preview: LeadEmailPreview }>(`/lead-intake/rows/${rowId}/email-preview?expectedVersion=${expectedVersion}`)).preview;
    },
    async createGmailDraft(rowId: string, expectedVersion: number) {
      return api.post<{ link: LeadGmailDraftLink; reused: boolean }>(`/lead-intake/rows/${rowId}/gmail-draft`, { expectedVersion });
    },
    async listCommunicationBlocks() {
      return (await api.get<{ blocks: CommunicationBlock[] }>("/lead-intake/communication-blocks")).blocks;
    },
    async createCommunicationBlock(body: unknown) {
      return api.post<{ block: CommunicationBlock }>("/lead-intake/communication-blocks", body);
    },
    async removeCommunicationBlock(blockId: string, reason: string) {
      return api.post<{ block: CommunicationBlock }>(`/lead-intake/communication-blocks/${blockId}/remove`, { reason });
    },
    async getCommunicationBlockHistory(blockId: string) {
      return (await api.get<{ events: CommunicationBlockEvent[] }>(
        `/lead-intake/communication-blocks/${blockId}/history`,
      )).events;
    },
  };
}

export const leadIntakeClient = createLeadIntakeClient({ get: apiGet, post: apiPost });
