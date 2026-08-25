import { Router, type IRouter } from "express";

import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import type {
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "@/features/google-workspace/google-api-types";
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
  if (code === "GOOGLE_WORKSPACE_NOT_CONNECTED") return 409;
  if (
    code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE" ||
    code === "GOOGLE_WORKSPACE_PROFILE_FILES_UNAVAILABLE"
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

function latestPerThread(
  rows: Array<{
    mapping: GoogleApprovedValidationMapping;
    metadata: GoogleMessageMetadata;
  }>,
) {
  const byThread = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = byThread.get(row.mapping.threadId);
    if (
      !current ||
      (row.metadata.internalDateMs ?? 0) >
        (current.metadata.internalDateMs ?? 0)
    ) {
      byThread.set(row.mapping.threadId, row);
    }
  }
  return [...byThread.values()].sort(
    (left, right) =>
      (right.metadata.internalDateMs ?? 0) -
        (left.metadata.internalDateMs ?? 0) ||
      left.mapping.threadId.localeCompare(right.mapping.threadId),
  );
}

export function createGoogleWorkspaceProfileEmailRouter(options?: {
  connection?: ConnectionAccess;
  validationRepository?: ValidationAccess;
  fileService?: FileAccess;
}): IRouter {
  const router: IRouter = Router();
  const connection = options?.connection ?? new PostgresGoogleConnectionRepository();
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();
  const fileService = options?.fileService ?? new GoogleProfileFileService();

  router.get(
    "/google-workspace/profiles/:organizationId/emails",
    async (req, res): Promise<void> => {
      try {
        const mappings = await validationRepository.listApprovedForOrganization(
          req.params.organizationId,
        );
        const client = await connection.createReadClient();
        if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
        if (!client.getMessageMetadata) {
          throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE");
        }

        const withMetadata = await Promise.all(
          mappings.map(async (mapping) => ({
            mapping,
            metadata: await client.getMessageMetadata!(mapping.messageId),
          })),
        );
        const conversations = latestPerThread(withMetadata).map(
          ({ mapping, metadata }) => ({
            threadId: mapping.threadId,
            subject: metadata.headers.subject,
            from: metadata.headers.from,
            to: metadata.headers.to,
            date: metadata.headers.date,
            internalDateMs: metadata.internalDateMs,
            hasAttachments: metadata.hasAttachments,
            contactId: mapping.contactId,
            evidenceCodes: mapping.evidenceCodes,
            originalGmailUrl: gmailUrl(mapping.threadId),
          }),
        );

        res.json({ validationSampleOnly: false, historicalBackfillIncluded: true, conversations });
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.get(
    "/google-workspace/profiles/:organizationId/emails/:threadId",
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