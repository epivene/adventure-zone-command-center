import { logger } from "@/lib/logger";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import { PaperNoteImageError, preparePaperNoteImage } from "./paper-note-image";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import {
  PaperNoteExtractionRepository,
  PaperNoteExtractionRepositoryError,
} from "./paper-note-extraction-repository";
import {
  DefaultPaperNoteExtractionProvider,
  PaperNoteProviderError,
  type PaperNoteExtractionProvider,
} from "./paper-note-extraction-provider";

const LEASE_MS = 5 * 60 * 1000;

type Repository = Pick<
  PaperNoteExtractionRepository,
  "claimNextPage" | "updateStage" | "completePage" | "failPage"
>;
type Storage = Pick<PaperNoteObjectStorage, "get" | "putAnalysis">;

type WorkerDependencies = {
  repository: Repository;
  storage: Storage;
  provider: PaperNoteExtractionProvider;
};

export function applyPaperNotePageLastContactDate(
  extraction: PaperNoteExtraction,
  pageActivityDate: string | null,
): PaperNoteExtraction {
  if (!pageActivityDate) return extraction;
  if (extraction.activity.dateSource === "entry" && extraction.activity.occurredOn) return extraction;
  return {
    ...extraction,
    activity: {
      ...extraction.activity,
      rawDateText: extraction.activity.rawDateText ?? pageActivityDate,
      occurredOn: pageActivityDate,
      dateSource: "page_heading",
    },
  };
}

function failure(error: unknown) {
  if (error instanceof PaperNoteProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: true,
    };
  }
  if (error instanceof PaperNoteImageError) {
    return {
      code: error.code,
      message: "The stored image could not be prepared for handwriting reading.",
      retryable: false,
    };
  }
  if (error instanceof PaperNoteExtractionRepositoryError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: "EXTRACTION_FAILED",
    message: "This paper-note page could not be read. Retry the page.",
    retryable: true,
  };
}

export class PaperNoteExtractionWorker {
  constructor(private readonly dependencies: WorkerDependencies) {}

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<{ kind: "idle" | "processed"; pageId?: string }> {
    const claimed = await this.dependencies.repository.claimNextPage({
      workerId: input.workerId,
      now: input.now,
      leaseMs: LEASE_MS,
    });
    if (!claimed) return { kind: "idle" };

    const startedAt = Date.now();
    try {
      const originalBytes = await this.dependencies.storage.get(claimed.originalObjectKey);
      const prepared = await preparePaperNoteImage({
        bytes: originalBytes,
        declaredMimeType: claimed.declaredMimeType,
      });
      const analysisObjectKey = await this.dependencies.storage.putAnalysis({
        batchId: claimed.batchId,
        pageId: claimed.pageId,
        bytes: originalBytes,
        mimeType: prepared.detectedMimeType,
      });

      await this.dependencies.repository.updateStage({
        pageId: claimed.pageId,
        leaseToken: claimed.leaseToken,
        stage: "segment",
        now: new Date(),
      });
      const segmentation = await this.dependencies.provider.segmentPage({
        bytes: originalBytes,
        mimeType: prepared.detectedMimeType,
        rotationDegrees: claimed.rotationDegrees,
      });

      await this.dependencies.repository.updateStage({
        pageId: claimed.pageId,
        leaseToken: claimed.leaseToken,
        stage: "extract_entries",
        contextPatch: {
          entryCount: segmentation.entries.length,
        },
        now: new Date(),
      });

      const entries = [];
      for (const entryHint of segmentation.entries) {
        const extracted = applyPaperNotePageLastContactDate(
          await this.dependencies.provider.extractEntry({
            bytes: originalBytes,
            mimeType: prepared.detectedMimeType,
            pageContext: {
              pageHeading: segmentation.pageHeading,
              pageActivityDate: segmentation.pageActivityDate,
            },
            entryHint,
            rotationDegrees: claimed.rotationDegrees,
          }),
          segmentation.pageActivityDate,
        );
        entries.push({
          ...extracted,
          sourceRegion: entryHint.region,
          mayContinue: entryHint.mayContinue,
        });
      }

      await this.dependencies.repository.completePage({
        pageId: claimed.pageId,
        leaseToken: claimed.leaseToken,
        analysisObjectKey,
        segmentation,
        entries,
        now: new Date(),
      });
      logger.info({
        batchId: claimed.batchId,
        pageId: claimed.pageId,
        stage: "complete",
        attempt: claimed.attemptCount,
        durationMs: Date.now() - startedAt,
        extractedEntryCount: entries.length,
      }, "Paper note page extraction completed");
      return { kind: "processed", pageId: claimed.pageId };
    } catch (error) {
      const safe = failure(error);
      if (safe.code === "STALE_LEASE") {
        logger.info({
          batchId: claimed.batchId,
          pageId: claimed.pageId,
          stage: "stale_lease",
          attempt: claimed.attemptCount,
        }, "Paper note extraction lease became stale");
        return { kind: "processed", pageId: claimed.pageId };
      }
      await this.dependencies.repository.failPage({
        pageId: claimed.pageId,
        leaseToken: claimed.leaseToken,
        errorCode: safe.code,
        safeMessage: safe.message,
        retryable: safe.retryable,
        now: new Date(),
      });
      logger.warn({
        batchId: claimed.batchId,
        pageId: claimed.pageId,
        stage: "failed",
        attempt: claimed.attemptCount,
        durationMs: Date.now() - startedAt,
        errorCode: safe.code,
      }, "Paper note page extraction needs attention");
      return { kind: "processed", pageId: claimed.pageId };
    }
  }
}

export function createPaperNoteExtractionWorker(input: {
  repository: PaperNoteExtractionRepository;
  storage: PaperNoteObjectStorage;
  provider?: PaperNoteExtractionProvider;
}) {
  return new PaperNoteExtractionWorker({
    repository: input.repository,
    storage: input.storage,
    provider: input.provider ?? new DefaultPaperNoteExtractionProvider(),
  });
}
