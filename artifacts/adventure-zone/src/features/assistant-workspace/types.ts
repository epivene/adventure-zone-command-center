export type Screenshot = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
};
export type Selection = {
  batchId?: string | null;
  organizationIds: string[];
  bookingId: string | null;
  threadId: string | null;
  draftId: string | null;
  eventYear: number | null;
};
export type Receipt = {
  kind: string;
  id: string;
  href: string;
  verifiedAt: string;
};
export type Action = {
  preview?: {
    available: boolean;
    title: string;
    summary: string;
    reviewHref: string | null;
    revision: string | null;
  } | null;
  id: string;
  kind: string;
  targetId: string;
  expectedRevision: string | null;
  arguments: unknown;
  status: string;
  result: { receipts?: Receipt[]; code?: string; data?: unknown } | null;
};
export type Draft = {
  id: string;
  revision: string;
  status: string;
  gmailDraftId: string | null;
  content: {
    to: string[];
    cc: string[];
    subject: string;
    html: string;
    text: string;
    threadId: string | null;
    attachmentIds: string[];
    templateId: string | null;
    templateVersion: string | null;
  };
};
export type UsageCost = {
  currency: "USD";
  estimatedUsd: number | null;
  status: "complete" | "partial" | "unavailable";
  pricedCalls: number;
  unpricedCalls: number;
  pricingVersions: string[];
  excluded: string[];
};
export type ConversationLifecycle = "active" | "archived" | "trashed";
export type ConversationListItem = {
  id: string;
  title: string;
  version: number;
  lifecycle?: ConversationLifecycle;
};
export type Conversation = {
  profileTasksEnabled?: boolean;
  profileTasks?: ProfileTask[];
  lifecycle?: ConversationLifecycle;
  usage?: { cost: UsageCost };
  summary?: unknown;
  id: string;
  title: string;
  version: number;
  selection: Selection;
  messages: {
    id: string;
    role: "user" | "assistant";
    text: string;
    attachments?: Screenshot[];
  }[];
  actions: Action[];
  drafts: Draft[];
  selectedModel?: string | null;
  campaigns?: CampaignBatch[];
  campaignReviews?: CampaignReview[];
  documentResults?: DocumentResult[];
  runs: {
    selection?: Selection;
    id: string;
    status: string;
    usage: { steps: number; tokens: number; cost?: UsageCost };
    result: { text: string; receipts: Receipt[] } | null;
  }[];
};
export type DocumentResult = {
  id: string;
  retrievedAt: string | null;
  data:
    | {
        view: "document_reading";
        documentId: string | null;
        sourceLabel: string;
        eventYear: number | null;
        version: string | null;
        complete: boolean;
        totalPages: number;
        missingPages: number[];
        cacheHit?: boolean;
        extractedAt?: string;
        extractionModel?: string | null;
      }
    | {
        view: "document_comparison";
        complete: boolean;
        sources: {
          id: string;
          title: string;
          category: string;
          organizationIds: string[];
          eventYear: number | null;
          version: string;
          complete: boolean;
          totalPages: number | null;
          missingPages: number[];
          cacheHit?: boolean;
          extractedAt?: string | null;
        }[];
      }
    | {
        view: "public_research";
        query: string;
        model: string;
        complete: boolean;
        parts: {
          text: string;
          citations: {
            url: string;
            title: string;
            startIndex: number;
            endIndex: number;
          }[];
        }[];
        consultedSources: { url: string; title: string }[];
        warnings: string[];
        savedResearch?: {
          id: string;
          generatedAt: string;
          expiresAt: string;
          reusedAt: string | null;
          stale: boolean;
        };
      }
    | {
        view: "commercial_records";
        profile: { id: string; name: string };
        eventYear: number;
        totals: {
          outstandingCents: number;
          depositRemainingCents: number;
          recordedPaidCents: number;
        };
        unclassified: {
          invoices: { id: string }[];
          contracts: { id: string }[];
        };
        historicalCount: number;
      };
};
export type Rule = {
  headVersion?: number;
  id: string;
  ruleKey: string;
  body: string;
  version: number | null;
  status: string;
  sourceLabel: string;
  organizationId: string | null;
  eventYear: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  reviewedAt: string | null;
};

export type CampaignBatch = {
  id: string;
  title: string;
  eventYear: number;
  criteria: string;
  revision: number;
  cursor: number;
  members: {
    organizationId: string;
    contactId?: string | null;
    bookingId?: string | null;
  }[];
  draftLinks: Record<string, string>;
};
export type CampaignReview = {
  batchId: string;
  member: { organizationId: string };
  profileName: string | null;
  eligible: boolean;
  reasons: string[];
  cautions: string[];
  checkedAt: string;
};
export type ProfileTaskCommand =
  "pause" | "resume" | "cancel" | "retry" | "skip";
export type ProfileTaskChange = {
  actionId: string;
  itemId: string;
  profileName: string;
  kind?: string;
  revision: string | null;
  available: boolean;
  conflict?: string | null;
  fields: { field: string; oldValue: unknown; newValue: unknown }[];
  sources: string[];
};
export type ProfileTask = {
  id: string;
  version: number;
  state:
    | "proposed"
    | "running"
    | "paused"
    | "waiting_review"
    | "completed"
    | "cancelled";
  pauseReason: string | null;
  scope: {
    objective: string;
    completionMode?: "manual" | "sourced_notes" | "profile_fields";
    profileIds: string[];
    eventYear: number | null;
    requestedFields: string[];
    taskCapUsd: number | null;
  };
  authority: { actionKinds: string[]; allowedFields: string[] };
  counts: {
    total: number;
    completed: number;
    needsReview: number;
    failed: number;
    remaining: number;
  };
  items: {
    id: string;
    profileId: string;
    profileName?: string;
    state: string;
    reason: string | null;
    actionIds: string[];
  }[];
  changes: ProfileTaskChange[];
};
