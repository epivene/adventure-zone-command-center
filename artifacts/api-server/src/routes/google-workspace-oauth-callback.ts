import { Router, type IRouter } from "express";

import {
  GOOGLE_WORKSPACE_READ_SCOPES,
  createGoogleWorkspaceReadClient,
} from "@/features/google-workspace/google-api-client";
import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import {
  PostgresGoogleConnectionRepository,
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
    }): Promise<GoogleConnectionView | { id: string }>;
  };
  createClient(input: {
    environment: GoogleWorkspaceEnvironment;
    refreshToken?: string;
  }): GoogleWorkspaceReadClient;
  now(): Date;
};

function queryValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code.startsWith("GOOGLE_WORKSPACE_")
  ) {
    return (error as { code: string }).code;
  }
  if (
    error instanceof Error &&
    error.message.startsWith("GOOGLE_WORKSPACE_")
  ) {
    return error.message;
  }
  return fallback;
}

function safeRedirect(returnPath: string): string {
  const value = returnPath.trim();
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/settings/google-workspace?connected=1";
  }
  const url = new URL(value, "https://command-center.invalid");
  url.searchParams.set("connected", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

function requiredScopesPresent(scopes: string[]): boolean {
  const granted = new Set(scopes);
  return GOOGLE_WORKSPACE_READ_SCOPES.every((scope) => granted.has(scope));
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
      const state = queryValue(req.query.state);
      if (!code || !state) {
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

        const client = dependencies.createClient({
          environment: environmentResult.value,
        });
        const authorization = await client.exchangeCode(code);
        if (!requiredScopesPresent(authorization.scopes)) {
          res.status(403).json({
            error: "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING",
          });
          return;
        }
        const identity = await client.accountIdentity();
        await dependencies.connectionRepository.upsertConnected({
          accountEmail: identity.email,
          googleSubject: identity.subject,
          refreshToken: authorization.refreshToken,
          scopes: authorization.scopes,
          now,
        });
        res.redirect(303, safeRedirect(consumed.returnPath));
      } catch (error) {
        const code = safeErrorCode(
          error,
          "GOOGLE_WORKSPACE_OAUTH_CALLBACK_FAILED",
        );
        const status =
          code === "GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING"
            ? 403
            : code === "GOOGLE_WORKSPACE_OAUTH_STATE_INVALID"
              ? 400
              : 502;
        res.status(status).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceOAuthCallbackRouter();
