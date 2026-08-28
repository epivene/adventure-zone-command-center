import { Router, type IRouter } from "express";

import {
  GOOGLE_WORKSPACE_REQUIRED_SCOPES,
  createGoogleWorkspaceReadClient,
} from "@/features/google-workspace/google-api-client";
import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import {
  PostgresGoogleConnectionRepository,
  type GoogleConnectionRole,
  type GoogleConnectionView,
} from "@/features/google-workspace/google-connection-repository";
import {
  PostgresGoogleOAuthStateRepository,
  type GoogleOAuthStateRepository,
} from "@/features/google-workspace/google-oauth-state-repository";
import {
  getGoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironmentResult,
} from "@/features/google-workspace/google-workspace-env";
import { validateOperationalCalendarScopes } from "@/features/google-workspace/calendar/operational-calendar-oauth";

export type GoogleWorkspaceOAuthCallbackDependencies = {
  getEnvironment(): GoogleWorkspaceEnvironmentResult;
  stateRepository: GoogleOAuthStateRepository;
  connectionRepository: {
    upsertConnected(input: {
      accountEmail: string;
      googleSubject: string | null;
      refreshToken: string;
      scopes: string[];
      now: Date;
      role?: GoogleConnectionRole;
      operationalCalendarId?: string | null;
    }): Promise<GoogleConnectionView | { id: string }>;
  };
  createClient(input: {
    environment: GoogleWorkspaceEnvironment;
    refreshToken?: string;
  }): GoogleWorkspaceReadClient;
  now(): Date;
};

const userInfoEmailScope =
  "https://www.googleapis.com/auth/userinfo.email";

function queryValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    ((error as { code: string }).code.startsWith("GOOGLE_WORKSPACE_") ||
      (error as { code: string }).code.startsWith("GOOGLE_OPERATIONAL_CALENDAR_"))
  ) {
    return (error as { code: string }).code;
  }
  if (
    error instanceof Error &&
    (error.message.startsWith("GOOGLE_WORKSPACE_") ||
      error.message.startsWith("GOOGLE_OPERATIONAL_CALENDAR_"))
  ) {
    return error.message;
  }
  return fallback;
}

function safeReturnUrl(
  appOrigin: string,
  returnPath: string,
  result:
    | { connected: true; role?: GoogleConnectionRole }
    | { error: "GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED" | "GOOGLE_WORKSPACE_OAUTH_PROVIDER_REJECTED" },
): string {
  const fallbackPath = "/settings/google-workspace";
  const value = returnPath.trim();
  const localPath =
    value.startsWith("/") && !value.startsWith("//")
      ? value
      : fallbackPath;

  let url: URL;
  try {
    url = new URL(localPath, `${appOrigin}/`);
    if (url.origin !== appOrigin) {
      throw new Error("cross-origin OAuth return path");
    }
  } catch {
    url = new URL(fallbackPath, `${appOrigin}/`);
  }

  if ("connected" in result) {
    url.searchParams.delete("googleError");
    url.searchParams.set("connected", "1");
    if (result.role === "operational_calendar") {
      url.searchParams.set("operationalCalendarConnected", "1");
    }
  } else {
    url.searchParams.delete("connected");
    url.searchParams.set("googleError", result.error);
  }
  return url.toString();
}

function canonicalScope(scope: string): string {
  return scope === userInfoEmailScope ? "email" : scope;
}

function validateWorkspaceScopes(scopes: string[]):
  | { ok: true; scopes: string[] }
  | { ok: false; error: string } {
  const granted = [
    ...new Set(
      scopes
        .map((scope) => canonicalScope(scope.trim()))
        .filter(Boolean),
    ),
  ];
  const approved = new Set<string>(GOOGLE_WORKSPACE_REQUIRED_SCOPES);
  const grantedSet = new Set(granted);

  if (GOOGLE_WORKSPACE_REQUIRED_SCOPES.some((scope) => !grantedSet.has(scope))) {
    return { ok: false, error: "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING" };
  }
  if (granted.some((scope) => !approved.has(scope))) {
    return { ok: false, error: "GOOGLE_WORKSPACE_UNEXPECTED_SCOPE_GRANTED" };
  }
  return { ok: true, scopes: granted };
}

function defaultDependencies(): GoogleWorkspaceOAuthCallbackDependencies {
  return {
    getEnvironment: getGoogleWorkspaceEnvironment,
    stateRepository: new PostgresGoogleOAuthStateRepository(),
    connectionRepository: new PostgresGoogleConnectionRepository(),
    createClient: createGoogleWorkspaceReadClient,
    now: () => new Date(),
  };
}

export function createGoogleWorkspaceOAuthCallbackRouter(
  dependencies: GoogleWorkspaceOAuthCallbackDependencies = defaultDependencies(),
): IRouter {
  const router: IRouter = Router();

  router.get(
    "/google-workspace/oauth/callback",
    async (req, res): Promise<void> => {
      const code = queryValue(req.query.code);
      const providerError = queryValue(req.query.error);
      const state = queryValue(req.query.state);
      if (!state || (!code && !providerError)) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_OAUTH_CALLBACK_INVALID" });
        return;
      }

      let environmentResult: GoogleWorkspaceEnvironmentResult;
      try {
        environmentResult = dependencies.getEnvironment();
      } catch (error) {
        res.status(503).json({
          error: safeErrorCode(
            error,
            "GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE",
          ),
        });
        return;
      }
      if (!environmentResult.configured) {
        res.status(503).json({ error: "GOOGLE_WORKSPACE_NOT_CONFIGURED" });
        return;
      }

      const now = dependencies.now();
      try {
        const consumed = await dependencies.stateRepository.consume({ state, now });
        if (!consumed) {
          res.status(400).json({ error: "GOOGLE_WORKSPACE_OAUTH_STATE_INVALID" });
          return;
        }
        const connectionRole: GoogleConnectionRole = consumed.connectionRole ?? "workspace";

        if (providerError) {
          const safeProviderError =
            providerError === "access_denied"
              ? "GOOGLE_WORKSPACE_OAUTH_ACCESS_DENIED"
              : "GOOGLE_WORKSPACE_OAUTH_PROVIDER_REJECTED";
          res.redirect(
            303,
            safeReturnUrl(
              environmentResult.value.appOrigin,
              consumed.returnPath,
              { error: safeProviderError },
            ),
          );
          return;
        }

        if (!code) {
          res.status(400).json({ error: "GOOGLE_WORKSPACE_OAUTH_CALLBACK_INVALID" });
          return;
        }

        const client = dependencies.createClient({
          environment: environmentResult.value,
        });
        const authorization = await client.exchangeCode(code);
        const validatedScopes = connectionRole === "operational_calendar"
          ? validateOperationalCalendarScopes(authorization.scopes)
          : validateWorkspaceScopes(authorization.scopes);
        if (!validatedScopes.ok) {
          res.status(403).json({ error: validatedScopes.error });
          return;
        }
        const identity = await client.accountIdentity();
        await dependencies.connectionRepository.upsertConnected({
          accountEmail: identity.email,
          googleSubject: identity.subject,
          refreshToken: authorization.refreshToken,
          scopes: validatedScopes.scopes,
          now,
          role: connectionRole,
          operationalCalendarId: connectionRole === "operational_calendar" ? identity.email : null,
        });
        res.redirect(
          303,
          safeReturnUrl(
            environmentResult.value.appOrigin,
            consumed.returnPath,
            { connected: true, role: connectionRole },
          ),
        );
      } catch (error) {
        const errorCode = safeErrorCode(
          error,
          "GOOGLE_WORKSPACE_OAUTH_CALLBACK_FAILED",
        );
        const status =
          errorCode === "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING" ||
          errorCode === "GOOGLE_WORKSPACE_UNEXPECTED_SCOPE_GRANTED" ||
          errorCode === "GOOGLE_OPERATIONAL_CALENDAR_REQUIRED_SCOPES_MISSING" ||
          errorCode === "GOOGLE_OPERATIONAL_CALENDAR_UNEXPECTED_SCOPE_GRANTED"
            ? 403
            : errorCode === "GOOGLE_WORKSPACE_ACCOUNT_CHANGE_REQUIRES_DISCONNECT"
              ? 409
              : errorCode === "GOOGLE_WORKSPACE_OAUTH_STATE_INVALID"
                ? 400
                : 502;
        res.status(status).json({ error: errorCode });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceOAuthCallbackRouter();
