export type Selection = {
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
export type Conversation = {
  id: string;
  title: string;
  version: number;
  selection: Selection;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  actions: Action[];
  drafts: Draft[];
  documentResults?: DocumentResult[];
  runs: {
    id: string;
    status: string;
    usage: { steps: number; tokens: number };
    result: { text: string; receipts: Receipt[] } | null;
  }[];
};
export type DocumentResult = {
  id: string;
  retrievedAt: string | null;
  data:
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
        }[];
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
