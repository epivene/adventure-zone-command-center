import type { GoogleThreadAttachment } from "./google-api-types";

export type ProfileEmailArchiveState =
  | "pending"
  | "complete"
  | "partial"
  | "failed";

export type ArchivedProfileEmailMessage = {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  internalDateMs: number | null;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  direction: "incoming" | "outgoing" | "unknown";
  bodyText: string;
  attachments: GoogleThreadAttachment[];
};

export type ArchivedProfileEmailThread = {
  id: string;
  organizationId: string;
  contactId: string | null;
  subject: string;
  originalGmailUrl: string | null;
  providerThreadIds: string[];
  archiveState: ProfileEmailArchiveState;
  lastSyncedAt: string | null;
  lastGmailErrorCode: string | null;
  messages: ArchivedProfileEmailMessage[];
};

export type ArchiveProfileEmailMessageInput = Omit<
  ArchivedProfileEmailMessage,
  "id"
>;

export type ArchiveThreadInput = {
  conversationId?: string;
  organizationId: string;
  contactId: string | null;
  gmailThreadId: string;
  subject: string;
  originalGmailUrl: string | null;
  archiveState: ProfileEmailArchiveState;
  lastSyncedAt: Date;
  messages: ArchiveProfileEmailMessageInput[];
};

export interface GoogleProfileEmailArchiveAccess {
  upsertThread(input: ArchiveThreadInput): Promise<ArchivedProfileEmailThread>;
  listForOrganization(
    organizationId: string,
  ): Promise<ArchivedProfileEmailThread[]>;
  getForOrganization(input: {
    organizationId: string;
    conversationId: string;
  }): Promise<ArchivedProfileEmailThread | null>;
  findByProviderThread(input: {
    organizationId: string;
    gmailThreadId: string;
  }): Promise<ArchivedProfileEmailThread | null>;
  recordSyncFailure(input: {
    conversationId: string;
    code: string;
    now: Date;
  }): Promise<void>;
}
