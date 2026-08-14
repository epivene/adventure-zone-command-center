import { logger } from "@/lib/logger";
import type { AiCompletionClient } from "../ai-suggestions/ai-client";
import {
  ARCHIVE_PROFILE_AI_POLICY_VERSION,
  resolveArchiveProfilesWithAiFactory,
  type ArchiveProfileAiDecision,
} from "./archive-profile-ai";
import type {
  ArchiveProfileImportStore,
  ClaimedArchiveProfileJob,
} from "./archive-profile-import-repository";
import { resolveArchiveProfile } from "./archive-profile-resolver";
import type {
  ArchiveProfileResolution,
  ArchiveProfileSourceContext,
} from "./archive-profile-import-types";

const AI_BATCH_SIZE = 20;

type StepResult = { kind: "idle" | "progress" };
type SafeMetadata = {
  jobId: string;
  runId: string;
  phase: ClaimedArchiveProfileJob["phase"];
  batchSize: number;
  errorCode: string | null;
};

export class ArchiveProfileImportWorker {
  constructor(
    private readonly dependencies: {
      store: ArchiveProfileImportStore;
      createAiClient(): Promise<AiCompletionClient>;
      clock: { now(): Date };
    },
  ) {}

  async runOne(input: { workerId: string; now: Date }): Promise<StepResult> {
    const claim = await this.claim(input);
    if (!claim) return { kind: "idle" };

    let batchSize = 0;
    try {
      const contexts = await this.dependencies.store.loadBatch({ ...claim, limit: 50 });
      batchSize = contexts.length;
      const records = await this.resolve(contexts);
      const committed = await this.dependencies.store.commitBatch({
        ...claim,
        records,
        now: this.dependencies.clock.now(),
      });
      logger.info(
        metadata(claim, batchSize, committed.status.lastErrorCode),
        "Archived profile import step committed",
      );
      return { kind: "progress" };
    } catch (error) {
      return this.handleClaimedFailure(claim, batchSize, error);
    }
  }

  private async claim(input: { workerId: string; now: Date }) {
    try {
      return await this.dependencies.store.claimNext(input);
    } catch (error) {
      throw boundedError(classifyFailure(error).errorCode);
    }
  }

  private async resolve(contexts: readonly ArchiveProfileSourceContext[]) {
    const resolved = contexts.map((context) => resolveArchiveProfile(context));
    const pending = resolved.flatMap((resolution, index) =>
      resolution.action === "needs_ai" ? [{ index, resolution }] : []
    );

    let clientPromise: Promise<AiCompletionClient> | null = null;
    const createClientOnce = () => {
      clientPromise ??= Promise.resolve().then(() => this.dependencies.createAiClient());
      return clientPromise;
    };

    for (let offset = 0; offset < pending.length; offset += AI_BATCH_SIZE) {
      const slice = pending.slice(offset, offset + AI_BATCH_SIZE);
      const decisions = await resolveArchiveProfilesWithAiFactory(
        createClientOnce,
        slice.map(({ resolution }) => resolution.projection),
      );
      const bySource = new Map(decisions.map((decision) => [decision.sourceRecordId, decision]));
      const aiProvider = await createClientOnce().then(
        (created) => safeProviderName(created.providerName),
        () => null,
      );
      for (const item of slice) {
        const source = contexts[item.index]!.source;
        const decision = bySource.get(source.sourceRecordId);
        resolved[item.index] = aiResolution(
          source.streamType,
          item.resolution,
          decision,
          aiProvider,
        );
      }
    }

    return contexts.map((context, index) => ({
      source: context.source,
      resolution: resolved[index]!,
    }));
  }

  private async handleClaimedFailure(
    claim: ClaimedArchiveProfileJob,
    batchSize: number,
    error: unknown,
  ): Promise<StepResult> {
    const failure = classifyFailure(error);
    if (failure.errorCode === "archive_profile_lease_lost") {
      logger.error(
        metadata(claim, batchSize, failure.errorCode),
        "Archived profile import step stopped",
      );
      return { kind: "progress" };
    }

    try {
      await this.dependencies.store.failBatch({
        ...claim,
        errorCode: failure.errorCode,
        retryable: failure.retryable,
        now: this.dependencies.clock.now(),
      });
    } catch (failError) {
      const failCode = classifyFailure(failError).errorCode;
      if (failCode === "archive_profile_lease_lost") {
        logger.error(
          metadata(claim, batchSize, failCode),
          "Archived profile import step stopped",
        );
        return { kind: "progress" };
      }
      throw boundedError(failCode);
    }

    logger.error(
      metadata(claim, batchSize, failure.errorCode),
      "Archived profile import step failed",
    );
    return { kind: "progress" };
  }
}

function aiResolution(
  streamType: ArchiveProfileSourceContext["source"]["streamType"],
  pending: Extract<ArchiveProfileResolution, { action: "needs_ai" }>,
  decision: ArchiveProfileAiDecision | undefined,
  aiProvider: string | null,
): ArchiveProfileResolution {
  const evidenceLabels = [...new Set([
    ...pending.evidenceLabels,
    ...(decision?.evidenceLabels ?? []),
  ])].sort();
  const provenance = {
    resolutionPolicyVersion: ARCHIVE_PROFILE_AI_POLICY_VERSION,
    aiProvider,
    aiConfidence: decision && "confidence" in decision ? decision.confidence : null,
  };
  if (!decision) {
    return { action: "preserve", reasonCode: "ai_invalid_response", evidenceLabels, provenance };
  }
  if (decision.action === "retry_later") {
    return { action: "retry_later", reasonCode: decision.reasonCode, evidenceLabels, provenance };
  }
  if (decision.action === "preserve_for_later") {
    return {
      action: "preserve",
      reasonCode: decision.reasonCode === "ai_preserve_requested"
        ? "missing_required_identity"
        : decision.reasonCode,
      evidenceLabels,
      provenance,
    };
  }
  return {
    action: "create_profile",
    targetEntityType: streamType === "company" ? "organization" : "contact",
    values: decision.values,
    evidenceLabels,
    provenance,
  };
}

function safeProviderName(providerName: string): string {
  const safe = providerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return safe || "unknown";
}

function metadata(
  claim: ClaimedArchiveProfileJob,
  batchSize: number,
  errorCode: string | null,
): SafeMetadata {
  return {
    jobId: claim.jobId,
    runId: claim.runId,
    phase: claim.phase,
    batchSize,
    errorCode,
  };
}

function classifyFailure(error: unknown): { errorCode: string; retryable: boolean } {
  const codes = boundedCauseCodes(error);
  const code = codes.find((candidate) => candidate === "archive_profile_lease_lost")
    ?? codes[0]
    ?? "";
  if (code === "archive_profile_lease_lost") {
    return { errorCode: code, retryable: false };
  }
  const optimisticConflict = codes.find((candidate) => [
    "archive_profile_target_set_changed",
    "profile_candidate_stale",
    "profile_source_link_stale",
  ].includes(candidate));
  if (optimisticConflict) {
    return { errorCode: optimisticConflict, retryable: true };
  }
  if (codes.some(isTransientDatabaseCode)) {
    return { errorCode: "archive_profile_database_unavailable", retryable: true };
  }
  return { errorCode: "archive_profile_batch_failed", retryable: false };
}

function boundedCauseCodes(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    if ("code" in current) {
      const value = (current as { code?: unknown }).code;
      if (typeof value === "string" && value.length <= 64) codes.push(value);
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : null;
  }
  return codes;
}

function isTransientDatabaseCode(code: string): boolean {
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EPIPE",
    "ETIMEDOUT",
    "40001",
    "40P01",
    "55P03",
    "57014",
    "57P01",
    "57P02",
    "57P03",
  ].includes(code) || code.startsWith("08") || code.startsWith("53");
}

function boundedError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
