import { logger } from "@/lib/logger";
import type { PaperNoteExtraction } from "./paper-note-extraction-schema";
import { recoverPaperNoteFutureActionReminder } from "./paper-note-future-action-reminder";
import { PaperNoteImageError, preparePaperNoteImage } from "./paper-note-image";
import type { PaperNoteObjectStorage } from "./paper-note-object-storage";
import { getPaperNotePageYear, setPaperNotePageYear } from "./paper-note-page-year-store";
import {
  PaperNoteExtractionRepository,
  PaperNoteExtractionRepositoryError,
} from "./paper-note-extraction-repository";
import {
  DefaultPaperNoteExtractionProvider,
  PaperNoteProviderError,
  type PaperNoteExtractionProvider,
} from "./paper-note-extraction-provider";
import { mergePaperNoteContinuationHints } from "./paper-note-reading-improvements";

const LEASE_MS = 5 * 60 * 1000;

const monthNumbers: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

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

function isoMonthDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function resolvePaperNotePageLastContactDate(
  parsedPageDate: string | null,
  pageHeading: string | null,
  paperYear: number | null,
) {
  if (parsedPageDate && /^\d{4}-\d{2}-\d{2}$/.test(parsedPageDate)) return parsedPageDate;
  if (!pageHeading || !paperYear) return null;
  const match = pageHeading.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (!match) return null;
  const month = monthNumbers[match[1]!.toLowerCase()];
  const day = Number(match[2]);
  if (!month || !Number.isInteger(day)) return null;
  return isoMonthDay(paperYear, month, day);
}

function withoutSupersededDateWarning(extraction: PaperNoteExtraction) {
  return extraction.warnings.filter((warning) => !(
    warning.fieldPath === "activity.occurredOn"
    && /could not be parsed/i.test(warning.message)
  ));
}

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
    warnings: withoutSupersededDateWarning(extraction),
  };
}

export function applyPaperNoteCallSheetDefaults(extraction: PaperNoteExtraction): PaperNoteExtraction {
  const futureAction = recoverPaperNoteFutureActionReminder(
    extraction.oldReminder?.trim() || extraction.transcription,
  );
  const methodIsFutureInstruction = Boolean(
    futureAction?.method
    && futureAction.method === extraction.activity.method,
  );
  const method = extraction.activity.method === "unknown" || methodIsFutureInstruction
    ? "call"
    : extraction.activity.method;
  if (method === extraction.activity.method) return extraction;
  return {
    ...extraction,
    activity: { ...extraction.activity, method },
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
      const paperYear = await getPaperNotePageYear(claimed.pageId);
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
      const segmentation = mergePaperNoteContinuationHints(await this.dependencies.provider.segmentPage({
        bytes: originalBytes,
        mimeType: prepared.detectedMimeType,
        rotationDegrees: claimed.rotationDegrees,
      }));
      const resolvedPageActivityDate = resolvePaperNotePageLastContactDate(
        segmentation.pageActivityDate,
        segmentation.pageHeading,
        paperYear,
      );
      const resolvedSegmentation = {
        ...segmentation,
        pageActivityDate: resolvedPageActivityDate,
      };

      await this.dependencies.repository.updateStage({
        pageId: claimed.pageId,
        leaseToken: claimed.leaseToken,
        stage: "extract_entries",
        contextPatch: {
          entryCount: resolvedSegmentation.entries.length,
          paperYear,
        },
        now: new Date(),
      });

      const entries = [];
      for (const entryHint of resolvedSegmentation.entries) {
        const extracted = applyPaperNoteCallSheetDefaults(applyPaperNotePageLastContactDate(
          await this.dependencies.provider.extractEntry({
            bytes: originalBytes,
            mimeType: prepared.detectedMimeType,
            pageContext: {
              pageHeading: resolvedSegmentation.pageHeading,
              pageActivityDate: resolvedSegmentation.pageActivityDate,
            },
            entryHint,
            rotationDegrees: claimed.rotationDegrees,
          }),
          resolvedSegmentation.pageActivityDate,
        ));
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
        segmentation: resolvedSegmentation,
        entries,
        now: new Date(),
      });
      if (paperYear) await setPaperNotePageYear(claimed.pageId, paperYear);
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
