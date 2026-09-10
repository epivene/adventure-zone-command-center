import { Router, type IRouter } from "express";

import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import {
  GoogleProfileFileService,
  type GoogleProfileFile,
} from "@/features/google-workspace/google-profile-file-service";
import {
  PostgresGoogleValidationRepository,
  type GoogleApprovedValidationMapping,
} from "@/features/google-workspace/google-validation-repository";

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ValidationAccess = {
  listApprovedForOrganization(
    organizationId: string,
  ): Promise<GoogleApprovedValidationMapping[]>;
  organizationOwnsApprovedThread(input: {
    organizationId: string;
    threadId: string;
  }): Promise<boolean>;
};

type FileAccess = {
  copyApprovedThreadAttachments(input: {
    organizationId: string;
    threadId: string;
  }): Promise<GoogleProfileFile[]>;
  listProfileFiles(organizationId: string): Promise<GoogleProfileFile[]>;
  openProfileFile(input: {
    organizationId: string;
    fileId: string;
  }): Promise<string>;
};

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_PROFILE_EMAIL_FAILED";
}

function errorStatus(code: string): number {
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_NOT_AUTHENTICATED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
  ) {
    return 409;
  }
  if (
    code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE" ||
    code === "GOOGLE_WORKSPACE_PROFILE_FILES_UNAVAILABLE" ||
    code === "GOOGLE_WORKSPACE_API_REQUEST_FAILED" ||
    code === "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED"
  ) {
    return 503;
  }
  if (
    code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_PROFILE_THREAD_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_PROFILE_FILE_NOT_FOUND"
  ) {
    return 404;
  }
  if (code === "GOOGLE_WORKSPACE_PROFILE_FILE_UNAVAILABLE") return 409;
  return 500;
}

function gmailUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function mappingsByThread(mappings: GoogleApprovedValidationMapping[]) {
  const grouped = new Map<string, GoogleApprovedValidationMapping[]>();
  for (const mapping of mappings) {
    const current = grouped.get(mapping.threadId) ?? [];
    current.push(mapping);
    grouped.set(mapping.threadId, current);
  }
  return grouped;
}

function conversationYear(conversation: {
  date: string;
  internalDateMs: number | null;
}): number | null {
  const parsedHeaderDate = Date.parse(conversation.date);
  if (Number.isFinite(parsedHeaderDate)) {
    return new Date(parsedHeaderDate).getUTCFullYear();
  }
  if (
    typeof conversation.internalDateMs === "number" &&
    Number.isFinite(conversation.internalDateMs)
  ) {
    return new Date(conversation.internalDateMs).getUTCFullYear();
  }
  return null;
}

export function createGoogleWorkspaceProfileEmailRouter(options?: {
  profilePath?: string;
  emailsOnly?: boolean;
  connection?: ConnectionAccess;
  validationRepository?: ValidationAccess;
  fileService?: FileAccess;
}): IRouter {
  const router: IRouter = Router();
  const profilePath = options?.profilePath ?? "/google-workspace/profiles";
  const connection = options?.connection ?? new PostgresGoogleConnectionRepository();
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();
  const fileService = options?.fileService ?? new GoogleProfileFileService();

  router.get(
    `${profilePath}/:organizationId/emails`,
    async (req, res): Promise<void> => {
      try {
        const mappings = await validationRepository.listApprovedForOrganization(
          req.params.organizationId,
        );
        const grouped = mappingsByThread(mappings);

        // Profiles with no matched Gmail should render an empty live mailbox area
        // without requiring a Google round-trip.
        if (!grouped.size) {
          res.json({
            validationSampleOnly: false,
            historicalBackfillIncluded: true,
            liveGmail: true,
            unavailableThreadCount: 0,
            conversations: [],
          });
          return;
        }

        const client = await connection.createReadClient();
        if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
        if (!client.getThreadDetail) {
          throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE");
        }

        const threadEntries = [...grouped.entries()];
        const settled = await Promise.allSettled(
          threadEntries.map(async ([threadId, threadMappings]) => ({
            threadId,
            threadMappings,
            thread: await client.getThreadDetail!(threadId),
          })),
        );

        const successes = settled.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const failures = settled.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );

        // A stale/deleted Gmail thread should not break every other matched
        // conversation on the profile. If Gmail itself is unavailable, however,
        // surface the real Google error instead of pretending the mailbox is empty.
        if (!successes.length && failures.length) {
          throw failures[0];
        }

        const allConversations = successes
          .map(({ threadId, threadMappings, thread }) => {
            const latest = thread.messages.at(-1) ?? null;
            return {
              threadId,
              subject: thread.subject || latest?.subject || "",
              from: latest?.from ?? "",
              to: latest?.to ?? "",
              date: latest?.date ?? "",
              internalDateMs: latest?.internalDateMs ?? null,
              hasAttachments: thread.messages.some(
                (message) => message.attachments.length > 0,
              ),
              contactId:
                threadMappings.find((mapping) => mapping.contactId)?.contactId ?? null,
              evidenceCodes: [
                ...new Set(threadMappings.flatMap((mapping) => mapping.evidenceCodes)),
              ],
              originalGmailUrl: thread.originalGmailUrl || gmailUrl(threadId),
            };
          })
          .sort(
            (left, right) =>
              (right.internalDateMs ?? 0) - (left.internalDateMs ?? 0) ||
              left.threadId.localeCompare(right.threadId),
          );

        const currentYear = new Date().getUTCFullYear();
        const conversations = allConversations.filter(
          (conversation) => conversationYear(conversation) === currentYear,
        );
        const historicalConversations = allConversations.filter(
          (conversation) => conversationYear(conversation) !== currentYear,
        );

        const response: Record<string, unknown> = {
          validationSampleOnly: false,
          historicalBackfillIncluded: true,
          liveGmail: true,
          unavailableThreadCount: failures.length,
          conversations,
        };
        if (historicalConversations.length) {
          response.historicalConversations = historicalConversations;
        }
        res.json(response);
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.get(
    `${profilePath}/:organizationId/emails/:threadId`,
    async (req, res): Promise<void> => {
      try {
        const ownsThread =
          await validationRepository.organizationOwnsApprovedThread({
            organizationId: req.params.organizationId,
            threadId: req.params.threadId,
          });
        if (!ownsThread) {
          res.status(404).json({ error: "GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND" });
          return;
        }

        const client = await connection.createReadClient();
        if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
        if (!client.getThreadDetail) {
          throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE");
        }
        res.json(await client.getThreadDetail(req.params.threadId));
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  // Boss access exposes only conversation reads, never file-copy or write actions.
  if (options?.emailsOnly) return router;

  router.post(
    "/google-workspace/profiles/:organizationId/threads/:threadId/copy-files",
    async (req, res): Promise<void> => {
      try {
        const files = await fileService.copyApprovedThreadAttachments({
          organizationId: req.params.organizationId,
          threadId: req.params.threadId,
        });
        res.json({ files });
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.get(
    "/google-workspace/profiles/:organizationId/files",
    async (req, res): Promise<void> => {
      try {
        res.json({ files: await fileService.listProfileFiles(req.params.organizationId) });
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/profiles/:organizationId/files/:fileId/open",
    async (req, res): Promise<void> => {
      try {
        const url = await fileService.openProfileFile({
          organizationId: req.params.organizationId,
          fileId: req.params.fileId,
        });
        res.json({ url, expiresInSeconds: 900 });
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceProfileEmailRouter();
