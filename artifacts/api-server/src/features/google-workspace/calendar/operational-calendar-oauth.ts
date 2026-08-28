import type { GoogleWorkspaceEnvironment } from "@/features/google-workspace/google-workspace-env";

export const GOOGLE_OPERATIONAL_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar";

export const GOOGLE_OPERATIONAL_CALENDAR_SCOPES = [
  "openid",
  "email",
  GOOGLE_OPERATIONAL_CALENDAR_SCOPE,
] as const;

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";

export function operationalCalendarAuthorizationUrl(input: {
  environment: GoogleWorkspaceEnvironment;
  state: string;
}): string {
  if (!input.state.trim()) {
    throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
  }
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("client_id", input.environment.clientId);
  url.searchParams.set("redirect_uri", input.environment.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OPERATIONAL_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export function validateOperationalCalendarScopes(scopes: string[]):
  | { ok: true; scopes: string[] }
  | { ok: false; error: string } {
  const canonical = scopes.map((scope) =>
    scope === "https://www.googleapis.com/auth/userinfo.email" ? "email" : scope.trim(),
  );
  const granted = [...new Set(canonical.filter(Boolean))];
  const expected = new Set<string>(GOOGLE_OPERATIONAL_CALENDAR_SCOPES);
  const grantedSet = new Set(granted);
  if (GOOGLE_OPERATIONAL_CALENDAR_SCOPES.some((scope) => !grantedSet.has(scope))) {
    return { ok: false, error: "GOOGLE_OPERATIONAL_CALENDAR_REQUIRED_SCOPES_MISSING" };
  }
  if (granted.some((scope) => !expected.has(scope))) {
    return { ok: false, error: "GOOGLE_OPERATIONAL_CALENDAR_UNEXPECTED_SCOPE_GRANTED" };
  }
  return { ok: true, scopes: granted };
}
