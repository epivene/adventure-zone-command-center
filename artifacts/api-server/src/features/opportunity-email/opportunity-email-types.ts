export const opportunityDraftPurposeValues = ["new_outreach", "follow_up", "reply"] as const;
export const opportunityEmailStateValues = ["draft", "scheduled", "sent", "failed", "cancelled"] as const;

export type OpportunityDraftPurpose = (typeof opportunityDraftPurposeValues)[number];
export type OpportunityEmailState = (typeof opportunityEmailStateValues)[number];

export type OpportunityEmailRecord = {
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
  scheduledFor: Date | null;
  sentAt: Date | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
  sendRequestKey: string | null;
  scheduleRequestKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateOpportunityEmailInput = {
  opportunityId: string;
  organizationId: string;
  contactId?: string | null;
  eventYear: number;
  purpose: OpportunityDraftPurpose;
  state?: OpportunityEmailState;
  gmailDraftId?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  recipientEmail: string;
  recipientName?: string | null;
  subject: string;
  body: string;
  scheduledFor?: Date | null;
  sentAt?: Date | null;
  lastFailureCode?: string | null;
  lastFailureMessage?: string | null;
  sendRequestKey?: string | null;
  scheduleRequestKey?: string | null;
};

export type UpdateOpportunityEmailInput = Partial<
  Pick<
    OpportunityEmailRecord,
    | "contactId"
    | "purpose"
    | "state"
    | "gmailDraftId"
    | "gmailMessageId"
    | "gmailThreadId"
    | "recipientEmail"
    | "recipientName"
    | "subject"
    | "body"
    | "scheduledFor"
    | "sentAt"
    | "lastFailureCode"
    | "lastFailureMessage"
    | "sendRequestKey"
    | "scheduleRequestKey"
  >
>;
