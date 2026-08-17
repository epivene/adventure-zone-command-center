import { normalizeTimeline } from "@/features/act-replacement/normalizers/timeline-normalizer";
import {
  classifyActHistoryForPurge,
  type ActHistoryPurgeReason,
} from "./history-bookkeeping-classifier";
import {
  ActHistoryBookkeepingPurgeRepository,
  type ActHistoryPurgeCandidate,
} from "./history-bookkeeping-purge-repository";

export type ActHistoryPurgeBatchSummary = {
  scanned: number;
  purged: number;
  retained: number;
  byReason: Record<ActHistoryPurgeReason, number>;
  hasMore: boolean;
};

const defaultBatchSize = 100;
const maximumBatchSize = 250;
const scanWindowSize = 100;

function emptyReasons(): Record<ActHistoryPurgeReason, number> {
  return {
    relationship_bookkeeping: 0,
    record_lifecycle_bookkeeping: 0,
    field_change_bookkeeping: 0,
  };
}

function captureTimestamp(candidate: ActHistoryPurgeCandidate) {
  return candidate.capturedAt;
}

export class ActHistoryBookkeepingPurgeService {
  constructor(private readonly repository: ActHistoryBookkeepingPurgeRepository) {}

  async purgeNextBatch(input: { batchSize?: number } = {}): Promise<ActHistoryPurgeBatchSummary> {
    const requested = Number.isInteger(input.batchSize) ? Number(input.batchSize) : defaultBatchSize;
    const batchSize = Math.max(1, Math.min(maximumBatchSize, requested));
    const summary: ActHistoryPurgeBatchSummary = {
      scanned: 0,
      purged: 0,
      retained: 0,
      byReason: emptyReasons(),
      hasMore: false,
    };

    let afterSourceRecordId: string | null = null;

    while (summary.purged < batchSize) {
      const candidates = await this.repository.listCandidates({
        afterSourceRecordId,
        limit: scanWindowSize,
      });
      if (!candidates.length) {
        summary.hasMore = false;
        break;
      }

      for (const candidate of candidates) {
        afterSourceRecordId = candidate.sourceRecordId;
        summary.scanned += 1;

        const normalized = normalizeTimeline(
          candidate.rawSnapshot,
          captureTimestamp(candidate),
          candidate.streamType,
        );
        if (!normalized.ok) {
          summary.retained += 1;
          continue;
        }

        const decision = classifyActHistoryForPurge({
          subject: normalized.value.subject,
          body: normalized.value.body,
        });
        if (!decision.purge) {
          summary.retained += 1;
          continue;
        }

        await this.repository.purgeCandidate(candidate);
        summary.purged += 1;
        summary.byReason[decision.reason] += 1;
        if (summary.purged >= batchSize) {
          summary.hasMore = true;
          break;
        }
      }

      if (summary.purged >= batchSize) break;
      if (candidates.length < scanWindowSize) {
        summary.hasMore = false;
        break;
      }
      summary.hasMore = true;
    }

    return summary;
  }
}
