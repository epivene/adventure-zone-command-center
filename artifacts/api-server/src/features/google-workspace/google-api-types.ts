export type GoogleLabelSummary = {
  id: string;
  name: string;
  type: "system" | "user";
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
};

export type GoogleWorkspaceAccountIdentity = {
  subject: string | null;
  email: string;
};

export type GoogleMessageRef = {
  id: string;
  threadId: string;
};

export type GoogleMessageMetadata = {
  id: string;
  threadId: string;
  labelIds: string[];
  internalDateMs: number | null;
  snippet: string;
  headers: {
    from: string;
    to: string;
    cc: string;
    subject: string;
    date: string;
  };
  hasAttachments: boolean;
};

export type GoogleThreadAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  messageId: string;
};

export type GoogleThreadMessage = {
  id: string;
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

export type GoogleThreadDetail = {
  id: string;
  subject: string;
  originalGmailUrl: string;
  messages: GoogleThreadMessage[];
};

export interface GoogleWorkspaceReadClient {
  authorizationUrl(input: { state: string }): string;
  exchangeCode(code: string): Promise<{
    refreshToken: string;
    scopes: string[];
  }>;
  accountIdentity(): Promise<GoogleWorkspaceAccountIdentity>;
  listLabels(): Promise<GoogleLabelSummary[]>;
  listCalendars(): Promise<GoogleCalendarSummary[]>;
  listRecentMessageRefs?(limit: number): Promise<GoogleMessageRef[]>;
  getMessageMetadata?(id: string): Promise<GoogleMessageMetadata>;
  getThreadDetail?(threadId: string): Promise<GoogleThreadDetail>;
  getAttachment?(input: { messageId: string; attachmentId: string }): Promise<Uint8Array>;
}

export type GoogleWorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
