import { apiFetch } from "@/lib/auth-token";

export type GoogleWorkspaceConnectionView = {
  id: string;
  email: string;
  status: "connected" | "reauthorization_required" | "disconnected";
  grantedScopes: string[];
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
};

export type GoogleWorkspaceScopeLabel = {
  id: string;
  name: string;
  rootId: string;
  rootName: string;
};

export type GoogleWorkspaceScopeCalendar = {
  id: string;
  summary: string;
  primary: boolean;
};

export type GoogleWorkspaceSettingsView = {
  configured: boolean;
  connection: GoogleWorkspaceConnectionView | null;
  labels: GoogleWorkspaceScopeLabel[];
  calendars: GoogleWorkspaceScopeCalendar[];
};

export type GoogleWorkspaceScopePreview = {
  labels: GoogleWorkspaceScopeLabel[];
  calendars: GoogleWorkspaceScopeCalendar[];
  missingLabelRoots: string[];
  missingCalendars: string[];
  excludedLabels?: Array<{
    id: string;
    name: string;
    type: "user" | "system";
  }>;
  excludedLabelCount: number;
  excludedCalendarCount: number;
};

export type GoogleRecentValidationCandidate = {
  id: string;
  name: string;
  kind: "contact" | "organization" | "profile" | "booking";
};

export type GoogleValidationStatus =
  | "not_started"
  | "ready_for_review"
  | "approved"
  | "rejected";

export type GoogleRecentValidationRow = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  internalDateMs: number | null;
  labelIds: string[];
  labels: Array<{ id: string; name: string; type: "system" | "user" }>;
  hasAttachments: boolean;
  evidenceCodes: string[];
  candidates: GoogleRecentValidationCandidate[];
  matchedContact: { id: string; name: string } | null;
  resolvedOrganization: { id: string; name: string } | null;
  organizationCandidates: Array<{ id: string; name: string }>;
};

export type GoogleRecentValidationResult = {
  checkedLimit: number;
  aiEnabled: false;
  historicalImportStarted: false;
  validationStatus: GoogleValidationStatus;
  counts: {
    discovered: number;
    matched: number;
    needsReview: number;
    ignored: number;
  };
  matched: GoogleRecentValidationRow[];
  needsReview: GoogleRecentValidationRow[];
  ignored: GoogleRecentValidationRow[];
};

export type GoogleProfileLabelCleanupCandidate = {
  id: string;
  name: string;
};

export type GoogleProfileLabelCleanupResult = {
  deleted: GoogleProfileLabelCleanupCandidate[];
  skippedLabelIds: string[];
  failed: Array<
    GoogleProfileLabelCleanupCandidate & { errorCode: string }
  >;
};

export type GoogleProfileLabelSyncResult = {
  mutationId: string;
  state: "completed" | "retryable_error" | "permanent_error" | "conflict";
  gmailLabelId: string | null;
  gmailLabelName: string | null;
  errorCode: string | null;
};

export type GoogleValidationReviewItem = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  evidenceCodes: string[];
  candidates: Array<{ id: string; name: string }>;
  hasAttachments: boolean;
  state: "pending" | "resolved" | "ignored";
  resolvedOrganizationId: string | null;
  gmailSyncState:
    | "not_requested"
    | "pending"
    | "completed"
    | "retryable_error"
    | "permanent_error"
    | "conflict";
  gmailSyncErrorCode: string | null;
  gmailSyncMutationId: string | null;
};

export type GoogleHistoricalBackfillStatus =
  | "not_started"
  | "running"
  | "awaiting_approval"
  | "ready"
  | "complete"
  | "paused"
  | "error";

export type GoogleHistoricalBackfillState = {
  status: GoogleHistoricalBackfillStatus;
  nextPageToken: string | null;
  firstBatchApproved: boolean;
  cumulative: {
    processed: number;
    attached: number;
    ignored: number;
    needsReview: number;
    failed: number;
    skipped: number;
  };
};

export type GoogleHistoricalBackfillView = {
  syncEnabled: boolean;
  validationStatus: GoogleValidationStatus;
  state: GoogleHistoricalBackfillState;
};

export type GoogleHistoricalBatchResult = {
  batchId: string;
  processed: number;
  attached: number;
  ignored: number;
  needsReview: number;
  failed: number;
  skipped: number;
  nextPageAvailable: boolean;
  state: GoogleHistoricalBackfillStatus;
};

export type GoogleProfileEmailConversation = {
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
  contactId: string | null;
  evidenceCodes: string[];
  originalGmailUrl: string;
};

export type GoogleProfileEmailList = {
  validationSampleOnly: false;
  historicalBackfillIncluded: true;
  liveGmail: true;
  unavailableThreadCount: number;
  conversations: GoogleProfileEmailConversation[];
  historicalConversations?: GoogleProfileEmailConversation[];
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

export type GoogleProfileFile = {
  id: string;
  organizationId: string;
  threadId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string | null;
  storageObjectKey: string | null;
  availability: "available" | "file_unavailable" | "retry_required";
  lastErrorCode: string | null;
  createdAt: string;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `API ${response.status}`;
    throw new Error(code);
  }
  return body as T;
}

export async function getGoogleWorkspaceSettings(): Promise<GoogleWorkspaceSettingsView> {
  return responseJson<GoogleWorkspaceSettingsView>(
    await apiFetch("/google-workspace/settings"),
  );
}

export async function startGoogleWorkspaceOAuth(): Promise<{
  authorizationUrl: string;
}> {
  return responseJson(
    await apiFetch("/google-workspace/oauth/start", {
      method: "POST",
      body: "{}",
    }),
  );
}

export async function previewGoogleWorkspaceScope(): Promise<GoogleWorkspaceScopePreview> {
  return responseJson(
    await apiFetch("/google-workspace/scope/preview", {
      method: "POST",
      body: "{}",
    }),
  );
}

export async function saveGoogleWorkspaceScope(input: {
  labelIds: string[];
  calendarIds: string[];
}): Promise<{
  labels: GoogleWorkspaceScopeLabel[];
  calendars: GoogleWorkspaceScopeCalendar[];
}> {
  return responseJson(
    await apiFetch("/google-workspace/scope", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );
}

export async function runGoogleWorkspaceRecentValidation(
  limit = 100,
): Promise<GoogleRecentValidationResult> {
  return responseJson(
    await apiFetch("/google-workspace/validation/recent", {
      method: "POST",
      body: JSON.stringify({ limit }),
    }),
  );
}

export async function getGoogleWorkspaceValidationReview(): Promise<{
  items: GoogleValidationReviewItem[];
}> {
  return responseJson(
    await apiFetch("/google-workspace/validation/review"),
  );
}

export async function resolveGoogleWorkspaceValidationReview(
  messageId: string,
  organizationId: string,
): Promise<{
  ok: true;
  organizationId: string;
  threadId: string;
  gmailSync: GoogleProfileLabelSyncResult;
}> {
  return responseJson(
    await apiFetch(
      `/google-workspace/validation/review/${encodeURIComponent(messageId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ organizationId }),
      },
    ),
  );
}

export async function ignoreGoogleWorkspaceValidationReview(
  messageId: string,
): Promise<{ ok: true }> {
  return responseJson(
    await apiFetch(
      `/google-workspace/validation/review/${encodeURIComponent(messageId)}/ignore`,
      { method: "POST", body: "{}" },
    ),
  );
}

export async function retryGoogleWorkspaceGmailMutation(
  mutationId: string,
): Promise<{ ok: true; gmailSync: GoogleProfileLabelSyncResult }> {
  return responseJson(
    await apiFetch(
      `/google-workspace/gmail-mutations/${encodeURIComponent(mutationId)}/retry`,
      { method: "POST", body: "{}" },
    ),
  );
}

export async function decideGoogleWorkspaceValidationSample(
  decision: "approve" | "reject",
): Promise<{
  validationStatus: "approved" | "rejected";
  historicalImportStarted: false;
}> {
  return responseJson(
    await apiFetch("/google-workspace/validation/decision", {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  );
}

export async function getGoogleHistoricalBackfill(): Promise<GoogleHistoricalBackfillView> {
  return responseJson(
    await apiFetch("/google-workspace/historical-gmail"),
  );
}

export async function runNextGoogleHistoricalBatch(): Promise<GoogleHistoricalBatchResult> {
  return responseJson(
    await apiFetch("/google-workspace/historical-gmail/run-next", {
      method: "POST",
      body: "{}",
    }),
  );
}

export async function approveFirstGoogleHistoricalBatch(): Promise<{
  ok: true;
  state: GoogleHistoricalBackfillState;
}> {
  return responseJson(
    await apiFetch("/google-workspace/historical-gmail/approve-first-batch", {
      method: "POST",
      body: "{}",
    }),
  );
}

export async function pauseGoogleHistoricalBackfill(): Promise<{
  ok: true;
  state: GoogleHistoricalBackfillState;
}> {
  return responseJson(
    await apiFetch("/google-workspace/historical-gmail/pause", {
      method: "POST",
      body: "{}",
    }),
  );
}

export async function getGoogleProfileEmails(
  organizationId: string,
): Promise<GoogleProfileEmailList> {
  return responseJson<GoogleProfileEmailList>(
    await apiFetch(`/google-workspace/profiles/${encodeURIComponent(organizationId)}/emails`),
  );
}

export async function getGoogleProfileEmailThread(
  organizationId: string,
  threadId: string,
): Promise<GoogleThreadDetail> {
  return responseJson<GoogleThreadDetail>(
    await apiFetch(
      `/google-workspace/profiles/${encodeURIComponent(organizationId)}/emails/${encodeURIComponent(threadId)}`,
    ),
  );
}

export async function copyGoogleProfileThreadFiles(
  organizationId: string,
  threadId: string,
): Promise<{ files: GoogleProfileFile[] }> {
  return responseJson(
    await apiFetch(
      `/google-workspace/profiles/${encodeURIComponent(organizationId)}/threads/${encodeURIComponent(threadId)}/copy-files`,
      { method: "POST", body: "{}" },
    ),
  );
}

export async function getGoogleProfileFiles(
  organizationId: string,
): Promise<{ files: GoogleProfileFile[] }> {
  return responseJson(
    await apiFetch(`/google-workspace/profiles/${encodeURIComponent(organizationId)}/files`),
  );
}

export async function openGoogleProfileFile(
  organizationId: string,
  fileId: string,
): Promise<{ url: string; expiresInSeconds: number }> {
  return responseJson(
    await apiFetch(
      `/google-workspace/profiles/${encodeURIComponent(organizationId)}/files/${encodeURIComponent(fileId)}/open`,
      { method: "POST", body: "{}" },
    ),
  );
}

export async function getGoogleProfileLabelCleanupPreview(): Promise<{
  labels: GoogleProfileLabelCleanupCandidate[];
}> {
  return responseJson(
    await apiFetch("/google-workspace/profile-labels/cleanup"),
  );
}

export async function deleteGoogleProfileLabels(
  labelIds: string[],
): Promise<GoogleProfileLabelCleanupResult> {
  return responseJson(
    await apiFetch("/google-workspace/profile-labels/cleanup", {
      method: "POST",
      body: JSON.stringify({ labelIds, confirm: true }),
    }),
  );
}

export async function disconnectGoogleWorkspace(): Promise<{ ok: true }> {
  return responseJson(
    await apiFetch("/google-workspace/disconnect", {
      method: "POST",
      body: "{}",
    }),
  );
}