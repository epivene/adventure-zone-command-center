export type GoogleLabelSummary = {
  id: string;
  name: string;
  type: "system" | "user";
};


export type GoogleGmailLabelMutationClient = {
  listLabels(): Promise<GoogleLabelSummary[]>;
  getThreadLabelIds(threadId: string): Promise<string[]>;
  createLabel(name: string): Promise<GoogleLabelSummary>;
  deleteLabel(labelId: string): Promise<void>;
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

export type GoogleDriveBackupFile = {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  webViewLink: string | null;
  md5Checksum: string | null;
};

export type DriveCreateFileInput = {
  parentId: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type DriveUpdateFileInput = {
  fileId: string;
  name?: string;
  mimeType?: string;
  bytes?: Uint8Array;
  currentParentId?: string;
  parentId?: string;
};

export interface GoogleDriveBackupClient {
  findChild(
    parentId: string,
    name: string,
    mimeType?: string,
  ): Promise<GoogleDriveBackupFile | null>;
  createFolder(parentId: string, name: string): Promise<GoogleDriveBackupFile>;
  createFile(input: DriveCreateFileInput): Promise<GoogleDriveBackupFile>;
  updateFile(input: DriveUpdateFileInput): Promise<GoogleDriveBackupFile>;
  getFile(fileId: string): Promise<GoogleDriveBackupFile>;
}

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
  labelIds?: string[];
  internalDateMs: number | null;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  direction: "incoming" | "outgoing" | "unknown";
  bodyText: string;
  bodyHtml?: string;
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

export type GoogleGmailDraft = {
  draftId: string;
  messageId: string;
  threadId?: string | null;
};
export type GoogleGmailDraftRaw = GoogleGmailDraft & {raw:string};
export type GoogleGmailDraftClient = {
  getGmailDraftRaw?(draftId:string):Promise<GoogleGmailDraftRaw>;
  createGmailDraft(input: { raw: string; threadId?: string | null }): Promise<GoogleGmailDraft>;
  updateGmailDraft?(input: { draftId: string; raw: string; threadId?: string | null }): Promise<GoogleGmailDraft>;
};

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
  driveBackup?: GoogleDriveBackupClient;
  authorizationUrl(input: { state: string; scopes?: readonly string[] }): string;
  exchangeCode(code: string): Promise<{
    refreshToken: string;
    scopes: string[];
  }>;
  accountIdentity(): Promise<GoogleWorkspaceAccountIdentity>;
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
  listCalendars(): Promise<GoogleCalendarSummary[]>;
  listCalendarEvents?(input: { calendarIds: string[]; timeMin: string; timeMax: string }): Promise<GoogleCalendarEvent[]>;
  listRecentMessageRefs?(limit: number): Promise<GoogleMessageRef[]>;
  listMessagePage?(input: {
    maxResults: number;
    pageToken?: string | null;
    query?: string | null;
    labelIds?: string[];
  }): Promise<GoogleMessagePage>;
  getMessageMetadata?(id: string): Promise<GoogleMessageMetadata>;
  getThreadDetail?(threadId: string): Promise<GoogleThreadDetail>;
  getGmailDraftRaw?(draftId:string):Promise<GoogleGmailDraftRaw>;
  getGmailMessageRaw?(messageId:string):Promise<{messageId:string;threadId:string;raw:string;labelIds:string[]}>;
  listGmailDrafts?(query:string, pageToken?:string | null):Promise<{drafts:{id:string;message:{id:string;threadId:string}}[];nextPageToken:string|null}>;
  getThreadLabelIds?(threadId: string): Promise<string[]>;
  getAttachment?(input: { messageId: string; attachmentId: string }): Promise<Uint8Array>;
  createGmailDraft?(input: { raw: string; threadId?: string | null }): Promise<GoogleGmailDraft>;
  updateGmailDraft?(input: { draftId: string; raw: string; threadId?: string | null }): Promise<GoogleGmailDraft>;
  deleteLabel?(labelId: string): Promise<void>;
  listDriveFiles?(parentId: string, pageToken?: string | null): Promise<GoogleDrivePage>;
  downloadDriveFile?(fileId: string, mimeType?: string): Promise<Uint8Array>;
}

export type GoogleWorkspaceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
