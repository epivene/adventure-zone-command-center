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
  runs: {
    id: string;
    status: string;
    usage: { steps: number; tokens: number };
    result: { text: string; receipts: Receipt[] } | null;
  }[];
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
