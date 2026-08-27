export type OpportunityDraftPurpose = "new_outreach" | "follow_up" | "reply";
export type OpportunityEmailState = "draft" | "scheduled" | "sent" | "failed" | "cancelled";
export type DraftRewriteAction =
  | "shorter"
  | "more_casual"
  | "more_direct"
  | "rewrite_opening"
  | "more_personal"
  | "stronger_follow_up"
  | "fix_wording";

export type OpportunityEmailDraft = {
  id: string;
  opportunityId: string;
  organizationId: string;
  contactId: string | null;
  eventYear: number;
  purpose: OpportunityDraftPurpose;
  state: OpportunityEmailState;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  scheduledFor: string | null;
  sentAt: string | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OutreachCompletion = {
  kind: "sent" | "scheduled";
  referenceAt: string;
};
