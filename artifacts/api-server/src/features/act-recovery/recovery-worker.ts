import type { RecoveryCandidate } from "./recovery-types";
import type { RecoveryApplyResult } from "./entity-recovery";

type RecoveryRepository = {
  claimNext(input: { workerId: string; now: Date }): Promise<RecoveryCandidate | null>;
  complete(input: {
    itemId: string;
    leaseToken: string;
    state: RecoveryApplyResult["state"];
    targetSummary?: Record<string, unknown>;
    now: Date;
  }): Promise<void>;
  failRetryable(input: {
    itemId: string;
    leaseToken: string;
    errorCode: string;
    retryAfter: Date;
    now: Date;
  }): Promise<void>;
};

type EntityRecovery = {
  recoverEntity(candidate: RecoveryCandidate): Promise<RecoveryApplyResult>;
};
type RelationshipRecovery = {
  recoverRelationship(candidate: RecoveryCandidate): Promise<RecoveryApplyResult>;
};
type TimelineRecovery = {
  recoverTimeline(candidate: RecoveryCandidate): Promise<RecoveryApplyResult>;
};

const entityStreams = new Set(["company", "contact", "opportunity", "group"]);
const timelineStreams = new Set(["note", "history", "activity"]);
const relationshipStreams = new Set([
  "company_contact",
  "opportunity_company",
  "opportunity_contact",
  "group_contact",
  "activity_contact",
  "activity_company",
  "activity_opportunity",
  "note_contact",
  "note_company",
  "note_opportunity",
  "history_contact",
  "history_company",
  "history_opportunity",
]);
const retryDelayMs = 30_000;

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const value = String((error as { code?: unknown }).code ?? "").trim();
    if (value) return value.slice(0, 120);
  }
  return "act_recovery_step_failed";
}

export class ActArchiveRecoveryWorker {
  constructor(private readonly dependencies: {
    repository: RecoveryRepository;
    entityRecovery: EntityRecovery;
    relationshipRecovery: RelationshipRecovery;
    timelineRecovery: TimelineRecovery;
  }) {}

  async runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "progress" }> {
    const candidate = await this.dependencies.repository.claimNext(input);
    if (!candidate) return { kind: "idle" };

    try {
      const result = await this.recover(candidate);
      await this.dependencies.repository.complete({
        itemId: candidate.itemId,
        leaseToken: candidate.leaseToken,
        state: result.state,
        targetSummary: result.targetSummary,
        now: input.now,
      });
    } catch (error) {
      await this.dependencies.repository.failRetryable({
        itemId: candidate.itemId,
        leaseToken: candidate.leaseToken,
        errorCode: safeErrorCode(error),
        retryAfter: new Date(input.now.getTime() + retryDelayMs),
        now: input.now,
      });
    }
    return { kind: "progress" };
  }

  private recover(candidate: RecoveryCandidate): Promise<RecoveryApplyResult> {
    if (entityStreams.has(candidate.streamType)) {
      return this.dependencies.entityRecovery.recoverEntity(candidate);
    }
    if (timelineStreams.has(candidate.streamType)) {
      return this.dependencies.timelineRecovery.recoverTimeline(candidate);
    }
    if (relationshipStreams.has(candidate.streamType)) {
      return this.dependencies.relationshipRecovery.recoverRelationship(candidate);
    }
    return Promise.resolve({
      state: "dropped_unusable",
      targetSummary: {
        reason: "unsupported_archive_stream",
        streamType: candidate.streamType,
      },
    });
  }
}
