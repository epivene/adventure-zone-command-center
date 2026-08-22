import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import {
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
  GoogleScopeService,
  type GoogleSavedScope,
  type GoogleScopePreview,
} from "@/features/google-workspace/google-scope-service";
import {
  getGoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironment,
  type GoogleWorkspaceEnvironmentResult,
} from "@/features/google-workspace/google-workspace-env";

const emptyBodySchema = z.object({}).strict();
const oauthStartSchema = z
  .object({
    returnPath: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine(
        (value) => value.startsWith("/") && !value.startsWith("//"),
        "Return path must be local",
      )
      .optional(),
  })
  .strict();
const scopeSchema = z
  .object({
    labelIds: z.array(z.string().trim().min(1).max(256)).min(1).max(500),
    calendarIds: z.array(z.string().trim().min(1).max(512)).min(1).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.labelIds).size !== value.labelIds.length) {
      context.addIssue({
        code: "custom",
        path: ["labelIds"],
        message: "Duplicate label IDs are not allowed",
      });
    }
    if (new Set(value.calendarIds).size !== value.calendarIds.length) {
      context.addIssue({
        code: "custom",
        path: ["calendarIds"],
        message: "Duplicate calendar IDs are not allowed",
      });
    }
  });

type OwnerRequest = Request & { userId?: string };

type GoogleWorkspaceSettingsDependencies = {
  getEnvironment(): GoogleWorkspaceEnvironmentResult;
  stateRepository: GoogleOAuthStateRepository;
  connectionRepository: {
    getCurrent(): Promise<GoogleConnectionView | null>;
    disconnect(now: Date): Promise<void>;
  };
  scopeService: {
    preview(): Promise<GoogleScopePreview>;
    getSaved(): Promise<GoogleSavedScope>;
    save(input: {
      labelIds: string[];
      calendarIds: string[];
      actorKind: "owner";
      actorId: string;
      now: Date;
    }): Promise<GoogleSavedScope>;
  };
  createClient(input: {
    environment: GoogleWorkspaceEnvironment;
    refreshToken?: string;
  }): GoogleWorkspaceReadClient;
  randomState(): string;
  now(): Date;
};

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

function errorStatus(code: string): number {
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONFIGURED" ||
    code === "GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE" ||
    code === "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID" ||
    code === "GOOGLE_WORKSPACE_REDIRECT_URI_INVALID" ||
    code === "GOOGLE_WORKSPACE_REDIRECT_URI_MUST_USE_HTTPS" ||
    code === "GOOGLE_WORKSPACE_APP_ORIGIN_INVALID" ||
    code === "GOOGLE_WORKSPACE_APP_ORIGIN_MUST_USE_HTTPS"
  ) {
    return 503;
  }
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_SCOPE_INCOMPLETE"
  ) {
    return 409;
  }
  if (
    code === "GOOGLE_WORKSPACE_SCOPE_SELECTION_INVALID" ||
    code === "GOOGLE_WORKSPACE_SCOPE_INPUT_INVALID"
  ) {
    return 400;
  }
  return 500;
}

function defaultDependencies(): GoogleWorkspaceSettingsDependencies {
  const connectionRepository = new PostgresGoogleConnectionRepository();
  return {
    getEnvironment: getGoogleWorkspaceEnvironment,
    stateRepository: new PostgresGoogleOAuthStateRepository(),
    connectionRepository,
    scopeService: new GoogleScopeService({ connection: connectionRepository }),
    createClient: createGoogleWorkspaceReadClient,
    randomState: () => randomBytes(32).toString("base64url"),
    now: () => new Date(),
  };
}

function ownerActorId(req: Request): string {
  return ((req as OwnerRequest).userId || "owner").trim() || "owner";
}

export function createGoogleWorkspaceSettingsRouter(
  dependencies: GoogleWorkspaceSettingsDependencies = defaultDependencies(),
): IRouter {
  const router: IRouter = Router();

  router.get("/google-workspace/settings", async (_req, res): Promise<void> => {
    try {
      const environment = dependencies.getEnvironment();
      const connection = await dependencies.connectionRepository.getCurrent();
      const scope = connection
        ? await dependencies.scopeService.getSaved()
        : { labels: [], calendars: [] };
      res.json({
        configured: environment.configured,
        connection,
        labels: scope.labels,
        calendars: scope.calendars,
      });
    } catch (error) {
      const code = safeErrorCode(
        error,
        "GOOGLE_WORKSPACE_SETTINGS_LOAD_FAILED",
      );
      res.status(errorStatus(code)).json({ error: code });
    }
  });

  router.post(
    "/google-workspace/oauth/start",
    async (req, res): Promise<void> => {
      const parsed = oauthStartSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_OAUTH_START_INVALID" });
        return;
      }

      try {
        const environment = dependencies.getEnvironment();
        if (!environment.configured) {
          res.status(503).json({ error: "GOOGLE_WORKSPACE_NOT_CONFIGURED" });
          return;
        }
        const state = dependencies.randomState();
        if (!state.trim()) {
          throw new Error("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
        }
        const now = dependencies.now();
        await dependencies.stateRepository.create({
          state,
          returnPath:
            parsed.data.returnPath ?? "/settings/google-workspace",
          expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        });
        const client = dependencies.createClient({
          environment: environment.value,
        });
        res.json({ authorizationUrl: client.authorizationUrl({ state }) });
      } catch (error) {
        const code = safeErrorCode(
          error,
          "GOOGLE_WORKSPACE_OAUTH_START_FAILED",
        );
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/scope/preview",
    async (req, res): Promise<void> => {
      if (!emptyBodySchema.safeParse(req.body ?? {}).success) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_SCOPE_PREVIEW_INVALID" });
        return;
      }
      try {
        res.json(await dependencies.scopeService.preview());
      } catch (error) {
        const code = safeErrorCode(
          error,
          "GOOGLE_WORKSPACE_SCOPE_PREVIEW_FAILED",
        );
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.put("/google-workspace/scope", async (req, res): Promise<void> => {
    const parsed = scopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "GOOGLE_WORKSPACE_SCOPE_INPUT_INVALID" });
      return;
    }
    try {
      res.json(
        await dependencies.scopeService.save({
          labelIds: parsed.data.labelIds,
          calendarIds: parsed.data.calendarIds,
          actorKind: "owner",
          actorId: ownerActorId(req),
          now: dependencies.now(),
        }),
      );
    } catch (error) {
      const code = safeErrorCode(error, "GOOGLE_WORKSPACE_SCOPE_SAVE_FAILED");
      res.status(errorStatus(code)).json({ error: code });
    }
  });

  router.post(
    "/google-workspace/disconnect",
    async (req, res): Promise<void> => {
      if (!emptyBodySchema.safeParse(req.body ?? {}).success) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_DISCONNECT_INVALID" });
        return;
      }
      try {
        await dependencies.connectionRepository.disconnect(dependencies.now());
        res.json({ ok: true });
      } catch (error) {
        const code = safeErrorCode(
          error,
          "GOOGLE_WORKSPACE_DISCONNECT_FAILED",
        );
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceSettingsRouter();
