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

export async function disconnectGoogleWorkspace(): Promise<{ ok: true }> {
  return responseJson(
    await apiFetch("/google-workspace/disconnect", {
      method: "POST",
      body: "{}",
    }),
  );
}
