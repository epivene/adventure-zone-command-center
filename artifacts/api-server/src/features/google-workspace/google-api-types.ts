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

export interface GoogleWorkspaceReadClient {
  authorizationUrl(input: { state: string }): string;
  exchangeCode(code: string): Promise<{
    refreshToken: string;
    scopes: string[];
  }>;
  accountIdentity(): Promise<GoogleWorkspaceAccountIdentity>;
  listLabels(): Promise<GoogleLabelSummary[]>;
  listCalendars(): Promise<GoogleCalendarSummary[]>;
}

export type GoogleWorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
