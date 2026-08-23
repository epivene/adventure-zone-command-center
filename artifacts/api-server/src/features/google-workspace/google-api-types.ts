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

export interface GoogleWorkspaceReadClient {
  authorizationUrl(input: { state: string }): string;
  exchangeCode(code: string): Promise<{
    refreshToken: string;
    scopes: string[];
  }>;
  accountIdentity(): Promise<GoogleWorkspaceAccountIdentity>;
  listLabels(): Promise<GoogleLabelSummary[]>;
  listCalendars(): Promise<GoogleCalendarSummary[]>;
  listRecentMessageRefs(limit: number): Promise<GoogleMessageRef[]>;
  getMessageMetadata(id: string): Promise<GoogleMessageMetadata>;
}

export type GoogleWorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
