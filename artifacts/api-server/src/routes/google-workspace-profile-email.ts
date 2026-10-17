import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import type { GoogleWorkspaceReadClient } from "@/features/google-workspace/google-api-types";
import { GoogleProfileEmailArchiveService } from "@/features/google-workspace/google-profile-email-archive-service";
import type { ArchivedProfileEmailThread } from "@/features/google-workspace/google-profile-email-archive-types";
import { GoogleProfileEmailReplyService } from "@/features/google-workspace/google-profile-email-reply-service";
import { GoogleProfileLabelValidationImportService } from "@/features/google-workspace/google-profile-label-validation-import";
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

type LabelImportAccess = {
  reconcileOrganization(organizationId: string): Promise<GoogleApprovedValidationMapping[]>;
};

type ArchiveAccess = {
  archiveApprovedThread(input: {
    organizationId: string;
    contactId: string | null;
    gmailThreadId: string;
  }): Promise<ArchivedProfileEmailThread>;
};

type ReplyAccess = {
  reply(input: {
    organizationId: string;
    conversationId: string;
    bodyText: string;
    actorId: string;
  }): Promise<{
    conversation: ArchivedProfileEmailThread;
    gmailMessageId: string;
    gmailThreadId: string;
  }>;
};

type OwnerRequest = Request & { userId?: string };
const replySchema = z.object({
  bodyText: z.string().trim().min(1).max(100_000),
}).strict();

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
    code === "GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED" ||
    code === "GOOGLE_WORKSPACE_GMAIL_SEND_FAILED" ||
    code === "GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN"
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
  if (code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_REPLY_INVALID") return 400;
  if (
    code === "GOOGLE_WORKSPACE_PROFILE_FILE_UNAVAILABLE" ||
    code === "GOOGLE_WORKSPACE_PROFILE_EMAIL_RECIPIENT_MISSING"
  ) return 409;
  return 500;
}

// Bound expensive Gmail/archive work across profile-list requests in this process.
let activeListLoads = 0;
const listLoadWaiters: Array<() => void> = [];
async function withListLoadSlot<T>(load: () => Promise<T>): Promise<T> {
  if (activeListLoads >= 2)
    await new Promise<void>((resolve) => listLoadWaiters.push(resolve));
  else activeListLoads++;
  try {
    return await load();
  } finally {
    const next = listLoadWaiters.shift();
    if (next) next();
    else activeListLoads--;
  }
}
async function mapListSummaries<T, R>(
  items: T[],
  load: (item: T) => Promise<R>,
) {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        try {
          results[current] = {
            status: "fulfilled",
            value: await withListLoadSlot(() => load(items[current])),
          };
        } catch (reason) {
          results[current] = { status: "rejected", reason };
        }
      }
    }),
  );
  return results;
}

function gmailUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;
}

function sourceState(thread: ArchivedProfileEmailThread) {
  if (!thread.lastGmailErrorCode) return "synced" as const;
  return thread.lastGmailErrorCode === "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND"
    ? "saved_copy_gmail_missing" as const
    : "saved_copy_gmail_unavailable" as const;
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
  archiveService?: ArchiveAccess;
  replyService?: ReplyAccess;
  labelImportService?: LabelImportAccess;
}): IRouter {
  const router: IRouter = Router();
  const profilePath = options?.profilePath ?? "/google-workspace/profiles";
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();
  const fileService = options?.fileService ?? new GoogleProfileFileService();
  const archiveService =
    options?.archiveService ?? new GoogleProfileEmailArchiveService();
  const replyService = options?.replyService ?? new GoogleProfileEmailReplyService();
  const labelImportService =
    options?.labelImportService ??
    (options?.validationRepository
      ? { reconcileOrganization: async () => [] }
      : new GoogleProfileLabelValidationImportService());

  // Share only unfinished loads. Different routers/actors cannot share a response.
  const listLoads = new Map<string, Promise<Record<string, unknown>>>();
  router.get(
    `${profilePath}/:organizationId/emails`,
    async (req, res): Promise<void> => {
      const key = `${(req as OwnerRequest).userId ?? "owner"}:${req.params.organizationId}`;
      try {
        let pending = listLoads.get(key);
        if (!pending) {
          pending = (async () => {
            let mappings =
              await validationRepository.listApprovedForOrganization(
                req.params.organizationId,
              );
            try {
              const reconciled = await labelImportService.reconcileOrganization(
                req.params.organizationId,
              );
              if (reconciled.length || !mappings.length) mappings = reconciled;
            } catch (error) {
              if (
                !mappings.length &&
                errorCode(error) === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
              ) {
                throw error;
              }
              // Label recovery is best effort. A Gmail rate limit or stale label
              // must not make an otherwise healthy profile fail to load.
            }
            const grouped = mappingsByThread(mappings);

            // Profiles with no matched Gmail should render an empty live mailbox area
            // without requiring a Google round-trip.
            if (!grouped.size) {
              return {
                validationSampleOnly: false,
                historicalBackfillIncluded: true,
                liveGmail: true,
                unavailableThreadCount: 0,
                conversations: [],
              };
            }

            const settled = await mapListSummaries(
              [...grouped.entries()],
              async ([threadId, threadMappings]) => {
                const thread = await archiveService.archiveApprovedThread({
                  organizationId: req.params.organizationId,
                  contactId:
                    threadMappings.find((mapping) => mapping.contactId)
                      ?.contactId ?? null,
                  gmailThreadId: threadId,
                });
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
                    threadMappings.find((mapping) => mapping.contactId)
                      ?.contactId ?? null,
                  evidenceCodes: [
                    ...new Set(
                      threadMappings.flatMap(
                        (mapping) => mapping.evidenceCodes,
                      ),
                    ),
                  ],
                  originalGmailUrl:
                    thread.originalGmailUrl || gmailUrl(threadId),
                  conversationId: thread.id,
                  savedCopy: true,
                  archiveState: thread.archiveState,
                  sourceState: sourceState(thread),
                };
              },
            );
            const successes = settled.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : [],
            );
            const failures = settled.flatMap((result) =>
              result.status === "rejected" ? [result.reason] : [],
            );
            if (!successes.length && failures.length) throw failures[0];
            const allConversations = successes.sort(
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
            return response;
          })();
          listLoads.set(key, pending);
          void pending
            .finally(() => {
              if (listLoads.get(key) === pending) listLoads.delete(key);
            })
            .catch(() => {});
        }
        res.json(await pending);
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

        const archived = await archiveService.archiveApprovedThread({
          organizationId: req.params.organizationId,
          contactId: null,
          gmailThreadId: req.params.threadId,
        });
        res.json({
          id: req.params.threadId,
          conversationId: archived.id,
          subject: archived.subject,
          originalGmailUrl:
            archived.originalGmailUrl || gmailUrl(req.params.threadId),
          savedCopy: true,
          archiveState: archived.archiveState,
          lastSyncedAt: archived.lastSyncedAt,
          lastGmailErrorCode: archived.lastGmailErrorCode,
          sourceState: sourceState(archived),
          messages: archived.messages.map((message) => ({
            id: message.gmailMessageId,
            internalDateMs: message.internalDateMs,
            from: message.from,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            date: message.date,
            direction: message.direction,
            bodyText: message.bodyText,
            attachments: message.attachments,
          })),
        });
      } catch (error) {
        const code = errorCode(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  // Boss access exposes only conversation reads, never file-copy or write actions.
  if (options?.emailsOnly) return router;

  router.post(
    `${profilePath}/:organizationId/email-conversations/:conversationId/reply`,
    async (req, res): Promise<void> => {
      const parsed = replySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "GOOGLE_WORKSPACE_PROFILE_EMAIL_REPLY_INVALID",
        });
        return;
      }
      try {
        const result = await replyService.reply({
          organizationId: req.params.organizationId,
          conversationId: req.params.conversationId,
          bodyText: parsed.data.bodyText,
          actorId:
            ((req as OwnerRequest).userId || "owner").trim() || "owner",
        });
        res.json({
          id: result.gmailThreadId,
          conversationId: result.conversation.id,
          subject: result.conversation.subject,
          originalGmailUrl:
            result.conversation.originalGmailUrl ||
            gmailUrl(result.gmailThreadId),
          savedCopy: true,
          archiveState: result.conversation.archiveState,
          lastSyncedAt: result.conversation.lastSyncedAt,
          lastGmailErrorCode: result.conversation.lastGmailErrorCode,
          sourceState: sourceState(result.conversation),
          messages: result.conversation.messages.map((message) => ({
            id: message.gmailMessageId,
            internalDateMs: message.internalDateMs,
            from: message.from,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            date: message.date,
            direction: message.direction,
            bodyText: message.bodyText,
            attachments: message.attachments,
          })),
        });
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
