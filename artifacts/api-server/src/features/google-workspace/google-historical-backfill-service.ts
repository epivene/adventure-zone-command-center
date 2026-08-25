import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type {
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import {
  GoogleHistoricalBackfillRepository,
  type GoogleHistoricalBackfillState,
} from "./google-historical-backfill-repository";
import {
  GoogleHistoricalMessageClassifier,
  type GoogleHistoricalClassification,
} from "./google-historical-message-classifier";
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
  finishBatch(input: {
    batchId: string;
    nextPageToken: string | null;
    firstBatch: boolean;
    counts: GoogleHistoricalBackfillState["cumulative"];
  }): Promise<void>;
  markError?(code: string): Promise<void>;
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

export class GoogleHistoricalBackfillService {
  private readonly connection: ConnectionAccess;
  private readonly repository: RepositoryAccess;
  private readonly classifier: ClassifierAccess;
  private readonly validationRepository: ValidationRepositoryAccess;

  constructor(options?: {
    connection?: ConnectionAccess;
    repository?: RepositoryAccess;
    classifier?: ClassifierAccess;
    validationRepository?: ValidationRepositoryAccess;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.repository = options?.repository ?? new GoogleHistoricalBackfillRepository();
    this.classifier = options?.classifier ?? new GoogleHistoricalMessageClassifier();
    this.validationRepository =
      options?.validationRepository ?? new PostgresGoogleValidationRepository();
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
      (state.cumulative.processed > 0 && !state.firstBatchApproved)
    ) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_FIRST_BATCH_APPROVAL_REQUIRED");
    }

    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!client.listMessagePage || !client.getMessageMetadata) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BACKFILL_UNAVAILABLE");
    }

    const firstBatch = state.cumulative.processed === 0;
    const { batchId } = await this.repository.beginBatch({
      pageToken: state.nextPageToken,
      batchSize: HISTORICAL_BATCH_SIZE,
    });

    let page;
    try {
      page = await client.listMessagePage({
        maxResults: HISTORICAL_BATCH_SIZE,
        pageToken: state.nextPageToken,
      });
    } catch (error) {
      const code = safeErrorCode(error);
      await this.repository.markError?.(code);
      throw error;
    }

    const counts: GoogleHistoricalBackfillState["cumulative"] = {
      processed: page.messages.length,
      attached: 0,
      ignored: 0,
      needsReview: 0,
      failed: 0,
      skipped: 0,
    };

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
        const classification = await this.classifier.classify(message, client);
        if (classification.outcome === "attached") {
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
          await this.repository.recordOutcome({
            batchId,
            messageId: message.id,
            threadId: message.threadId,
            outcome: "attached",
            organizationId: classification.organization.id,
          });
          counts.attached += 1;
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
}
