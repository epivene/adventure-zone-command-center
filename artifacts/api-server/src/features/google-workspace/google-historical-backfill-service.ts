import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type {
  GoogleMessageMetadata,
  GoogleMessageRef,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import {
  GoogleHistoricalBackfillRepository,
  type GoogleHistoricalBackfillState,
  type GoogleHistoricalFailedOutcome,
} from "./google-historical-backfill-repository";
import {
  GoogleHistoricalFrozenBatchStore,
  type GoogleHistoricalFrozenBatch,
} from "./google-historical-frozen-batch-store";
import {
  GoogleHistoricalMessageClassifier,
  type GoogleHistoricalClassification,
} from "./google-historical-message-classifier";
import { GoogleProfileFileService } from "./google-profile-file-service";
import {
  PostgresGoogleValidationRepository,
  type GoogleValidationMappingInput,
  type GoogleValidationReviewInput,
} from "./google-validation-repository";

const HISTORICAL_BATCH_SIZE = 250;

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type RepositoryAccess = {
  getState(): Promise<GoogleHistoricalBackfillState>;
  beginBatch(input: { pageToken: string | null; batchSize: number }): Promise<{ batchId: string }>;
  hasOutcome(messageId: string): Promise<boolean>;
  recordOutcome(input: {
    batchId: string;
    messageId: string;
    threadId: string;
    outcome: "attached" | "ignored" | "needs_review" | "failed" | "skipped";
    organizationId?: string | null;
    errorCode?: string | null;
  }): Promise<void>;
  listFailedOutcomes?(limit?: number): Promise<GoogleHistoricalFailedOutcome[]>;
  applyRetrySummary?(input: {
    resolvedFailed: number;
    attached: number;
    ignored: number;
    needsReview: number;
  }): Promise<void>;
  finishBatch(input: {
    batchId: string;
    nextPageToken: string | null;
    firstBatch: boolean;
    counts: GoogleHistoricalBackfillState["cumulative"];
  }): Promise<void>;
  markError?(code: string): Promise<void>;
};

type FrozenBatchAccess = {
  load(pageToken: string | null): Promise<GoogleHistoricalFrozenBatch | null>;
  freeze(input: {
    batchId: string;
    nextPageToken: string | null;
    messages: GoogleMessageRef[];
  }): Promise<void>;
};

type ClassifierAccess = {
  classify(
    message: GoogleMessageMetadata,
    client: GoogleWorkspaceReadClient,
  ): Promise<GoogleHistoricalClassification>;
};

type ValidationRepositoryAccess = {
  upsertRows(rows: GoogleValidationMappingInput[]): Promise<void>;
  upsertReviewItems(items: GoogleValidationReviewInput[]): Promise<void>;
};

type FileServiceAccess = {
  copyApprovedThreadAttachments(input: {
    organizationId: string;
    threadId: string;
  }): Promise<unknown>;
};

function safeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("GOOGLE_WORKSPACE_")) return code;
  }
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_HISTORICAL_MESSAGE_FAILED";
}

function isStopError(code: string): boolean {
  return code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_NOT_AUTHENTICATED";
}

function reviewInput(
  message: GoogleMessageMetadata,
  classification: Extract<GoogleHistoricalClassification, { outcome: "needs_review" }>,
): GoogleValidationReviewInput {
  return {
    messageId: message.id,
    threadId: message.threadId,
    subject: message.headers.subject,
    from: message.headers.from,
    to: message.headers.to,
    internalDateMs: message.internalDateMs,
    evidenceCodes: classification.evidenceCodes,
    candidates: classification.candidates,
    hasAttachments: message.hasAttachments,
  };
}

export type GoogleHistoricalBatchResult = {
  batchId: string;
  processed: number;
  attached: number;
  ignored: number;
  needsReview: number;
  failed: number;
  skipped: number;
  nextPageAvailable: boolean;
  state: GoogleHistoricalBackfillState["status"];
};

export type GoogleHistoricalRetryResult = {
  attempted: number;
  attached: number;
  ignored: number;
  needsReview: number;
  failed: number;
};

export class GoogleHistoricalBackfillService {
  private readonly connection: ConnectionAccess;
  private readonly repository: RepositoryAccess;
  private readonly frozenBatches: FrozenBatchAccess;
  private readonly classifier: ClassifierAccess;
  private readonly validationRepository: ValidationRepositoryAccess;
  private readonly fileService: FileServiceAccess;

  constructor(options?: {
    connection?: ConnectionAccess;
    repository?: RepositoryAccess;
    batchStore?: FrozenBatchAccess;
    classifier?: ClassifierAccess;
    validationRepository?: ValidationRepositoryAccess;
    fileService?: FileServiceAccess;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.repository = options?.repository ?? new GoogleHistoricalBackfillRepository();
    this.frozenBatches =
      options?.batchStore ??
      (options
        ? { load: async () => null, freeze: async () => undefined }
        : new GoogleHistoricalFrozenBatchStore());
    this.classifier = options?.classifier ?? new GoogleHistoricalMessageClassifier();
    this.validationRepository =
      options?.validationRepository ?? new PostgresGoogleValidationRepository();
    this.fileService =
      options?.fileService ??
      (options
        ? { copyApprovedThreadAttachments: async () => undefined }
        : new GoogleProfileFileService());
  }

  private async attach(
    message: GoogleMessageMetadata,
    classification: Extract<GoogleHistoricalClassification, { outcome: "attached" }>,
  ): Promise<void> {
    await this.validationRepository.upsertRows([{
      messageId: message.id,
      threadId: message.threadId,
      organizationId: classification.organization.id,
      contactId: null,
      evidenceCodes: [
        ...new Set([
          ...classification.evidenceCodes,
          "historical_gmail_backfill",
        ]),
      ],
    }]);
  }

  private async copyThreadFiles(
    organizationId: string,
    threadId: string,
  ): Promise<void> {
    await this.fileService
      .copyApprovedThreadAttachments({ organizationId, threadId })
      .catch(() => undefined);
  }

  async runNextBatch(): Promise<GoogleHistoricalBatchResult> {
    const state = await this.repository.getState();
    if (state.status === "complete") {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_COMPLETE");
    }
    if (state.status === "paused") {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_PAUSED");
    }
    if (
      state.status === "awaiting_approval" ||
      (state.cumulative.processed > 0 &&
        !state.firstBatchApproved &&
        state.status !== "error")
    ) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_FIRST_BATCH_APPROVAL_REQUIRED");
    }

    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!client.listMessagePage || !client.getMessageMetadata) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_UNAVAILABLE");
    }

    const firstBatch = !state.firstBatchApproved && state.nextPageToken === null;
    let frozen = await this.frozenBatches.load(state.nextPageToken);
    if (!frozen) {
      const { batchId } = await this.repository.beginBatch({
        pageToken: state.nextPageToken,
        batchSize: HISTORICAL_BATCH_SIZE,
      });
      let discovered;
      try {
        discovered = await client.listMessagePage({
          maxResults: HISTORICAL_BATCH_SIZE,
          pageToken: state.nextPageToken,
        });
        await this.frozenBatches.freeze({
          batchId,
          nextPageToken: discovered.nextPageToken,
          messages: discovered.messages,
        });
      } catch (error) {
        const code = safeErrorCode(error);
        await this.repository.markError?.(code);
        throw error;
      }
      frozen = {
        batchId,
        nextPageToken: discovered.nextPageToken,
        messages: discovered.messages,
      };
    }

    const batchId = frozen.batchId;
    const page = {
      messages: frozen.messages,
      nextPageToken: frozen.nextPageToken,
    };
    const counts: GoogleHistoricalBackfillState["cumulative"] = {
      processed: page.messages.length,
      attached: 0,
      ignored: 0,
      needsReview: 0,
      failed: 0,
      skipped: 0,
    };
    const batchThreadTargets = new Map<string, { id: string; name: string }>();
    const copiedFileThreads = new Set<string>();

    for (const ref of page.messages) {
      if (await this.repository.hasOutcome(ref.id)) {
        counts.skipped += 1;
        continue;
      }

      let message: GoogleMessageMetadata;
      try {
        message = await client.getMessageMetadata(ref.id);
      } catch (error) {
        const code = safeErrorCode(error);
        if (isStopError(code)) {
          await this.repository.markError?.(code);
          throw error;
        }
        counts.failed += 1;
        await this.repository.recordOutcome({
          batchId,
          messageId: ref.id,
          threadId: ref.threadId,
          outcome: "failed",
          errorCode: code,
        });
        continue;
      }

      try {
        const inheritedTarget = batchThreadTargets.get(message.threadId);
        const classification: GoogleHistoricalClassification = inheritedTarget
          ? {
              outcome: "attached",
              organization: inheritedTarget,
              evidenceCodes: ["existing_thread_association"],
            }
          : await this.classifier.classify(message, client);

        if (classification.outcome === "attached") {
          batchThreadTargets.set(message.threadId, classification.organization);
          await this.attach(message, classification);
          await this.repository.recordOutcome({
            batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "attached",
            organizationId: classification.organization.id,
          });
          counts.attached += 1;

          if (!copiedFileThreads.has(message.threadId)) {
            copiedFileThreads.add(message.threadId);
            await this.copyThreadFiles(
              classification.organization.id,
              message.threadId,
            );
          }
        } else if (classification.outcome === "needs_review") {
          await this.validationRepository.upsertReviewItems([
            reviewInput(message, classification),
          ]);
          await this.repository.recordOutcome({
            batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "needs_review",
          });
          counts.needsReview += 1;
        } else {
          await this.repository.recordOutcome({
            batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "ignored",
          });
          counts.ignored += 1;
        }
      } catch (error) {
        const code = safeErrorCode(error);
        if (isStopError(code)) {
          await this.repository.markError?.(code);
          throw error;
        }
        counts.failed += 1;
        await this.repository.recordOutcome({
          batchId,
          messageId: message.id,
          threadId: message.threadId,
          outcome: "failed",
          errorCode: code,
        });
      }
    }

    await this.repository.finishBatch({
      batchId,
      nextPageToken: page.nextPageToken,
      firstBatch,
      counts,
    });

    const resultState: GoogleHistoricalBackfillState["status"] = firstBatch
      ? "awaiting_approval"
      : page.nextPageToken
        ? "ready"
        : "complete";

    return {
      batchId,
      ...counts,
      nextPageAvailable: Boolean(page.nextPageToken),
      state: resultState,
    };
  }

  async retryFailures(limit = 250): Promise<GoogleHistoricalRetryResult> {
    if (!this.repository.listFailedOutcomes || !this.repository.applyRetrySummary) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_RETRY_UNAVAILABLE");
    }
    const failures = await this.repository.listFailedOutcomes(limit);
    if (!failures.length) {
      return { attempted: 0, attached: 0, ignored: 0, needsReview: 0, failed: 0 };
    }

    const client = await this.connection.createReadClient();
    if (!client || !client.getMessageMetadata) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_UNAVAILABLE");
    }

    const result: GoogleHistoricalRetryResult = {
      attempted: failures.length,
      attached: 0,
      ignored: 0,
      needsReview: 0,
      failed: 0,
    };
    const copiedFileThreads = new Set<string>();

    for (const failure of failures) {
      try {
        const message = await client.getMessageMetadata(failure.messageId);
        const classification = await this.classifier.classify(message, client);
        if (classification.outcome === "attached") {
          await this.attach(message, classification);
          await this.repository.recordOutcome({
            batchId: failure.batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "attached",
            organizationId: classification.organization.id,
          });
          result.attached += 1;
          if (!copiedFileThreads.has(message.threadId)) {
            copiedFileThreads.add(message.threadId);
            await this.copyThreadFiles(classification.organization.id, message.threadId);
          }
        } else if (classification.outcome === "needs_review") {
          await this.validationRepository.upsertReviewItems([
            reviewInput(message, classification),
          ]);
          await this.repository.recordOutcome({
            batchId: failure.batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "needs_review",
          });
          result.needsReview += 1;
        } else {
          await this.repository.recordOutcome({
            batchId: failure.batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "ignored",
          });
          result.ignored += 1;
        }
      } catch (error) {
        const code = safeErrorCode(error);
        if (isStopError(code)) throw error;
        result.failed += 1;
        await this.repository.recordOutcome({
          batchId: failure.batchId,
          messageId: failure.messageId,
          threadId: failure.threadId,
          outcome: "failed",
          errorCode: code,
        });
      }
    }

    const resolvedFailed = result.attached + result.ignored + result.needsReview;
    await this.repository.applyRetrySummary({
      resolvedFailed,
      attached: result.attached,
      ignored: result.ignored,
      needsReview: result.needsReview,
    });
    return result;
  }
}
