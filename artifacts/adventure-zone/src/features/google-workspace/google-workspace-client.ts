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
  validationSampleOnly: true;
  conversations: GoogleProfileEmailConversation[];
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

export async function disconnectGoogleWorkspace(): Promise<{ ok: true }> {
  return responseJson(
    await apiFetch("/google-workspace/disconnect", {
      method: "POST",
      body: "{}",
    }),
  );
}