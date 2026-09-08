export type GoogleLabelSummary = {
  id: string;
  name: string;
  type: "system" | "user";
};


export type GoogleGmailLabelMutationClient = {
  listLabels(): Promise<GoogleLabelSummary[]>;
  createLabel?(name: string): Promise<GoogleLabelSummary>;
  renameLabel?(input: { labelId: string; name: string }): Promise<GoogleLabelSummary>;
  modifyThreadLabels?(input: {
    threadId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
  modifyMessageLabels?(input: {
    messageId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
  createLabel(name: string): Promise<GoogleLabelSummary>;
  renameLabel(input: { labelId: string; name: string }): Promise<GoogleLabelSummary>;
  modifyThreadLabels(input: {
    threadId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
  modifyMessageLabels(input: {
    messageId: string;
    addLabelIds: string[];
    removeLabelIds: string[];
  }): Promise<void>;
};

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
};

export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: number | null;
  parents: string[];
  webViewLink: string | null;
};

export type GoogleDrivePage = {
  files: GoogleDriveFile[];
  nextPageToken: string | null;
};

export type GoogleWorkspaceAccountIdentity = {
  subject: string | null;
  email: string;
};

export type GoogleMessageRef = {
  id: string;
  threadId: string;
};

export type GoogleMessagePage = {
  messages: GoogleMessageRef[];
  nextPageToken: string | null;
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

export type GoogleCalendarEventTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

export type GoogleGmailDraft = { draftId: string; messageId: string };
export type GoogleGmailDraftClient = { createGmailDraft(input: { raw: string }): Promise<GoogleGmailDraft> };

export type GoogleCalendarEvent = {
  calendarId: string;
  calendarTimeZone: string;
  id: string;
  iCalUid: string | null;
  summary: string;
  description: string;
  start: GoogleCalendarEventTime;
  end: GoogleCalendarEventTime;
  updated: string | null;
  recurringEventId: string | null;
  originalStartTime: GoogleCalendarEventTime | null;
};

export interface GoogleWorkspaceReadClient {
  authorizationUrl(input: { state: string; scopes?: readonly string[] }): string;
  exchangeCode(code: string): Promise<{
    refreshToken: string;
    scopes: string[];
  }>;
  accountIdentity(): Promise<GoogleWorkspaceAccountIdentity>;
  listLabels(): Promise<GoogleLabelSummary[]>;
  listCalendars(): Promise<GoogleCalendarSummary[]>;
  listCalendarEvents?(input: { calendarIds: string[]; timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>;
  listRecentMessageRefs?(limit: number): Promise<GoogleMessageRef[]>;
  listMessagePage?(input: {
    maxResults: number;
    pageToken?: string | null;
    query?: string | null;
  }): Promise<GoogleMessagePage>;
  getMessageMetadata?(id: string): Promise<GoogleMessageMetadata>;
  getThreadDetail?(threadId: string): Promise<GoogleThreadDetail>;
  getAttachment?(input: { messageId: string; attachmentId: string }): Promise<Uint8Array>;
  createGmailDraft?(input: { raw: string }): Promise<GoogleGmailDraft>;
  listDriveFiles?(parentId: string, pageToken?: string | null): Promise<GoogleDrivePage>;
  downloadDriveFile?(fileId: string, mimeType?: string): Promise<Uint8Array>;
}

export type GoogleWorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
