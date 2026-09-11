import {
  createAiClient,
  type AiCompletionClient,
} from "@/features/ai-suggestions/ai-client";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import {
  GoogleRecentValidationService,
  type GoogleRecentValidationResult,
  type GoogleValidationRow,
} from "./google-recent-validation-service";
import type { GoogleWorkspaceReadClient } from "./google-api-types";
import {
  triageGoogleEmailWithAi,
  type GoogleAiEmailTriageResult,
} from "./google-ai-email-triage";

const AI_CONCURRENCY = 6;
const MAX_THREAD_TEXT = 18_000;

type BaseValidationAccess = {
  run(
    limit: number,
    options?: {
      skipProcessed?: boolean;
      deferProcessedMarking?: boolean;
    },
  ): Promise<GoogleRecentValidationResult>;
};

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

export type GoogleAiValidationRow = GoogleValidationRow & {
  aiTriage?: GoogleAiEmailTriageResult;
};

export type GoogleAiRecentValidationResult = Omit<
  GoogleRecentValidationResult,
  "aiEnabled" | "matched" | "needsReview" | "ignored" | "counts"
> & {
  aiEnabled: boolean;
  aiStatus: "enabled" | "disabled" | "unavailable";
  aiProvider: string | null;
  aiCounts: {
    attempted: number;
    matched: number;
    ignored: number;
    review: number;
  };
  counts: GoogleRecentValidationResult["counts"];
  matched: GoogleAiValidationRow[];
  needsReview: GoogleAiValidationRow[];
  ignored: GoogleAiValidationRow[];
};

type RowBucket = "review" | "ignored";

type ProcessedRow = {
  bucket: "matched" | "review" | "ignored";
  row: GoogleAiValidationRow;
  attempted: boolean;
};

function googleAiEnabledFromEnv(): boolean {
  return process.env.GOOGLE_WORKSPACE_AI_ENABLED?.trim().toLowerCase() === "true";
}

function isInternalProfileName(name: string): boolean {
  return name.trim().toLowerCase().startsWith("adventure zone");
}

function candidateProfiles(row: GoogleValidationRow): Array<{ id: string; name: string }> {
  const unique = new Map<string, { id: string; name: string }>();
  for (const candidate of row.organizationCandidates) {
    if (!isInternalProfileName(candidate.name)) unique.set(candidate.id, candidate);
  }
  for (const candidate of row.candidates) {
    if (
      (candidate.kind === "profile" || candidate.kind === "organization") &&
      !isInternalProfileName(candidate.name)
    ) {
      unique.set(candidate.id, { id: candidate.id, name: candidate.name });
    }
  }
  return [...unique.values()].slice(0, 12);
}

async function readableThreadText(
  client: GoogleWorkspaceReadClient,
  threadId: string,
): Promise<string> {
  if (!client.getThreadDetail) return "";
  try {
    const thread = await client.getThreadDetail(threadId);
    return thread.messages
      .map((message) => message.bodyText)
      .join("\n")
      .slice(0, MAX_THREAD_TEXT);
  } catch {
    return "";
  }
}

function withEvidence(row: GoogleValidationRow, code: string): string[] {
  return [...new Set([...row.evidenceCodes, code])];
}

async function processUncertainRow(input: {
  row: GoogleValidationRow;
  originalBucket: RowBucket;
  client: GoogleWorkspaceReadClient;
  ai: AiCompletionClient;
}): Promise<ProcessedRow> {
  // Conflicting explicit profile labels require an owner decision. Neither
  // body similarity nor AI may choose a winner or silently ignore the conflict.
  if (input.row.evidenceCodes.includes("profile_label_conflict")) {
    return { bucket: "review", row: input.row, attempted: false };
  }
  const profiles = candidateProfiles(input.row);
  const bodyText = await readableThreadText(input.client, input.row.threadId);
  const triage = await triageGoogleEmailWithAi({
    ai: input.ai,
    subject: input.row.subject,
    from: input.row.from,
    to: input.row.to,
    labels: input.row.labels.map((label) => label.name),
    bodyText,
    deterministicEvidence: input.row.evidenceCodes,
    matchedContactName: input.row.matchedContact?.name ?? null,
    candidateProfiles: profiles,
  });

  if (triage.outcome === "match" && triage.profileId) {
    const target = profiles.find((profile) => profile.id === triage.profileId);
    if (target) {
      return {
        bucket: "matched",
        attempted: true,
        row: {
          ...input.row,
          evidenceCodes: withEvidence(input.row, "ai_profile_match"),
          resolvedOrganization: target,
          aiTriage: triage,
        },
      };
    }
  }

  if (triage.outcome === "ignore") {
    return {
      bucket: "ignored",
      attempted: true,
      row: {
        ...input.row,
        evidenceCodes: withEvidence(input.row, "ai_ignore"),
        resolvedOrganization: null,
        aiTriage: triage,
      },
    };
  }

  // Low-confidence REVIEW is also the fail-closed shape for malformed/unavailable
  // model output. Do not inflate a deterministic ignored bucket in that case.
  const bucket =
    input.originalBucket === "ignored" && triage.confidence === "low"
      ? "ignored"
      : "review";
  return {
    bucket,
    attempted: true,
    row: {
      ...input.row,
      evidenceCodes: withEvidence(input.row, "ai_needs_review"),
      aiTriage: triage,
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      output[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return output;
}

export class GoogleAiRecentValidationService {
  private readonly baseValidation: BaseValidationAccess;
  private readonly connection: ConnectionAccess;
  private readonly aiFactory: () => Promise<AiCompletionClient>;
  private readonly aiEnabled: boolean;

  constructor(options?: {
    baseValidation?: BaseValidationAccess;
    connection?: ConnectionAccess;
    aiFactory?: () => Promise<AiCompletionClient>;
    aiEnabled?: boolean;
  }) {
    this.baseValidation = options?.baseValidation ?? new GoogleRecentValidationService();
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.aiFactory = options?.aiFactory ?? createAiClient;
    this.aiEnabled = options?.aiEnabled ?? googleAiEnabledFromEnv();
  }

  async run(
    limit = 100,
    options?: { skipProcessed?: boolean },
  ): Promise<GoogleAiRecentValidationResult> {
    const base = await this.baseValidation.run(limit, {
      ...options,
      deferProcessedMarking: true,
    });
    const emptyCounts = { attempted: 0, matched: 0, ignored: 0, review: 0 };

    if (!this.aiEnabled) {
      return {
        ...base,
        aiEnabled: false,
        aiStatus: "disabled",
        aiProvider: null,
        aiCounts: emptyCounts,
      };
    }

    let ai: AiCompletionClient;
    try {
      ai = await this.aiFactory();
    } catch {
      return {
        ...base,
        aiEnabled: false,
        aiStatus: "unavailable",
        aiProvider: null,
        aiCounts: emptyCounts,
      };
    }

    const client = await this.connection.createReadClient();
    if (!client) {
      return {
        ...base,
        aiEnabled: false,
        aiStatus: "unavailable",
        aiProvider: ai.providerName,
        aiCounts: emptyCounts,
      };
    }

    const uncertain = [
      ...base.needsReview.map((row) => ({ row, originalBucket: "review" as const })),
      ...base.ignored.map((row) => ({ row, originalBucket: "ignored" as const })),
    ];
    const processed = await mapWithConcurrency(
      uncertain,
      AI_CONCURRENCY,
      (item) => processUncertainRow({ ...item, client, ai }),
    );

    const matched: GoogleAiValidationRow[] = [...base.matched];
    const needsReview: GoogleAiValidationRow[] = [];
    const ignored: GoogleAiValidationRow[] = [];
    let aiMatched = 0;
    let aiIgnored = 0;
    let aiReview = 0;

    for (const item of processed) {
      if (item.bucket === "matched") {
        matched.push(item.row);
        aiMatched += 1;
      } else if (item.bucket === "ignored") {
        ignored.push(item.row);
        if (item.row.aiTriage?.outcome === "ignore") aiIgnored += 1;
      } else {
        needsReview.push(item.row);
        if (item.attempted) aiReview += 1;
      }
    }

    return {
      ...base,
      aiEnabled: true,
      aiStatus: "enabled",
      aiProvider: ai.providerName,
      aiCounts: {
        attempted: processed.filter((item) => item.attempted).length,
        matched: aiMatched,
        ignored: aiIgnored,
        review: aiReview,
      },
      counts: {
        discovered: base.counts.discovered,
        matched: matched.length,
        needsReview: needsReview.length,
        ignored: ignored.length,
      },
      matched,
      needsReview,
      ignored,
    };
  }
}
