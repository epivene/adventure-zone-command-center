import { Router, type IRouter } from "express";

import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import type {
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "@/features/google-workspace/google-api-types";
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

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_PROFILE_EMAIL_FAILED";
}

function errorStatus(code: string): number {
  if (code === "GOOGLE_WORKSPACE_NOT_CONNECTED") return 409;
  if (code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_UNAVAILABLE") return 503;
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
}): IRouter {
  const router: IRouter = Router();
  const connection = options?.connection ?? new PostgresGoogleConnectionRepository();
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();

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

        res.json({ validationSampleOnly: true, conversations });
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

  return router;
}

export default createGoogleWorkspaceProfileEmailRouter();