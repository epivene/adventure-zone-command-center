import { pool as defaultPool } from "@workspace/db";

import type {
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import {
  GoogleHistoricalMessageClassifier,
  type GoogleHistoricalClassification,
} from "./google-historical-message-classifier";
import {
  PostgresGoogleValidationRepository,
  type GoogleValidationMappingInput,
  type GoogleValidationReviewInput,
  type GoogleValidationStatus,
} from "./google-validation-repository";

const MAX_WINDOW_MS = 2 * 366 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 1_000;
const PAGE_SIZE = 250;

export type GoogleSentProfileTarget = {
  id: string;
  name: string;
};

export type GoogleSentProfileLinkTargets = {
  byMessage: Map<string, GoogleSentProfileTarget>;
  byThread: Map<string, GoogleSentProfileTarget>;
};

export type GoogleSentProfileLinkSweepConnection = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

export type GoogleSentProfileLinkSweepClassifier = {
  classify(
    message: GoogleMessageMetadata,
    client: GoogleWorkspaceReadClient,
  ): Promise<GoogleHistoricalClassification>;
};

export interface GoogleSentProfileLinkSweepRepository {
  mappedTargets(input: {
    messageIds: string[];
    threadIds: string[];
  }): Promise<GoogleSentProfileLinkTargets>;
  upsertMappings(rows: GoogleValidationMappingInput[]): Promise<void>;
  upsertReviewItems(rows: GoogleValidationReviewInput[]): Promise<void>;
  validationStatus(): Promise<GoogleValidationStatus>;
}

export type GoogleSentProfileLinkSweepRow = {
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  internalDateMs: number | null;
  organizationId: string;
  organizationName: string;
  evidenceCodes: string[];
};

export type GoogleSentProfileLinkSweepReview = {
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  internalDateMs: number | null;
  candidates: Array<{ id: string; name: string }>;
  evidenceCodes: string[];
};

export type GoogleSentProfileLinkSweepIgnored = {
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  internalDateMs: number | null;
  evidenceCodes: string[];
};

export type GoogleSentProfileLinkSweepFailure = {
  messageId: string;
  errorCode: string;
};

export type GoogleSentProfileLinkSweepResult = {
  after: string;
  before: string;
  repair: boolean;
  validationStatus: GoogleValidationStatus;
  pagesScanned: number;
  counts: {
    examined: number;
    sentInWindow: number;
    alreadyLinked: number;
    linked: number;
    needsReview: number;
    ignored: number;
    failed: number;
  };
  linked: GoogleSentProfileLinkSweepRow[];
  needsReview: GoogleSentProfileLinkSweepReview[];
  ignored: GoogleSentProfileLinkSweepIgnored[];
  failed: GoogleSentProfileLinkSweepFailure[];
};

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function errorCode(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_MESSAGE_FAILED";
}

function uniqueEvidence(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))];
}

function gmailDate(value: Date): string {
  return [
    String(value.getUTCFullYear()).padStart(4, "0"),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("/");
}

export function gmailSentWindowQuery(after: Date, before: Date): string {
  const searchAfter = new Date(Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate() - 1,
  ));
  const searchBefore = new Date(Date.UTC(
    before.getUTCFullYear(),
    before.getUTCMonth(),
    before.getUTCDate() + 1,
  ));
  return `in:sent after:${gmailDate(searchAfter)} before:${gmailDate(searchBefore)} -in:trash -in:spam`;
}

function validWindow(after: Date, before: Date): void {
  const afterMs = after.getTime();
  const beforeMs = before.getTime();
  if (
    !Number.isFinite(afterMs)
    || !Number.isFinite(beforeMs)
    || beforeMs <= afterMs
  ) {
    throw new Error("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_INVALID");
  }
  if (beforeMs - afterMs > MAX_WINDOW_MS) {
    throw new Error("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_TOO_LARGE");
  }
}

function inWindow(
  message: GoogleMessageMetadata,
  afterMs: number,
  beforeMs: number,
): boolean {
  return message.internalDateMs !== null
    && message.internalDateMs >= afterMs
    && message.internalDateMs < beforeMs;
}

function isSent(message: GoogleMessageMetadata): boolean {
  return message.labelIds.includes("SENT");
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
    evidenceCodes: uniqueEvidence(
      classification.evidenceCodes,
      ["sent_profile_link_sweep"],
    ),
    candidates: classification.candidates,
    hasAttachments: message.hasAttachments,
  };
}

export class GoogleSentProfileLinkSweepService {
  private readonly connection: GoogleSentProfileLinkSweepConnection;
  private readonly repository: GoogleSentProfileLinkSweepRepository;
  private readonly classifierFactory: () => GoogleSentProfileLinkSweepClassifier;

  constructor(options?: {
    connection?: GoogleSentProfileLinkSweepConnection;
    repository?: GoogleSentProfileLinkSweepRepository;
    classifier?: GoogleSentProfileLinkSweepClassifier;
    classifierFactory?: () => GoogleSentProfileLinkSweepClassifier;
  }) {
    this.connection = options?.connection ?? new PostgresGoogleConnectionRepository();
    this.repository = options?.repository ?? new PostgresGoogleSentProfileLinkSweepRepository();
    this.classifierFactory = options?.classifierFactory
      ?? (() => options?.classifier
        ?? new GoogleHistoricalMessageClassifier({ aiEnabled: false }));
  }

  async run(input: {
    after: Date;
    before: Date;
    repair: boolean;
  }): Promise<GoogleSentProfileLinkSweepResult> {
    validWindow(input.after, input.before);
    const client = await this.connection.createReadClient();
    if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!client.listMessagePage || !client.getMessageMetadata) {
      throw new Error("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_UNAVAILABLE");
    }

    // GoogleHistoricalMessageClassifier caches its CRM evidence snapshot. Build a
    // fresh classifier for every sweep so profiles or contacts added after process
    // start are eligible on the next automatic pass.
    const classifier = this.classifierFactory();

    const afterMs = input.after.getTime();
    const beforeMs = input.before.getTime();
    const mappings: GoogleValidationMappingInput[] = [];
    const reviews: GoogleValidationReviewInput[] = [];
    const linked: GoogleSentProfileLinkSweepRow[] = [];
    const needsReview: GoogleSentProfileLinkSweepReview[] = [];
    const ignored: GoogleSentProfileLinkSweepIgnored[] = [];
    const failed: GoogleSentProfileLinkSweepFailure[] = [];
    let examined = 0;
    let sentInWindow = 0;
    let alreadyLinked = 0;
    let pagesScanned = 0;
    let pageToken: string | null = null;

    do {
      if (pagesScanned >= MAX_PAGES) {
        throw new Error("GOOGLE_WORKSPACE_SENT_PROFILE_LINK_PAGE_LIMIT");
      }
      const page = await client.listMessagePage({
        maxResults: PAGE_SIZE,
        pageToken,
        query: gmailSentWindowQuery(input.after, input.before),
      });
      pagesScanned += 1;
      pageToken = page.nextPageToken;

      const metadata: GoogleMessageMetadata[] = [];
      for (const ref of page.messages) {
        try {
          const message = await client.getMessageMetadata(ref.id);
          metadata.push(message);
          examined += 1;
        } catch (error) {
          failed.push({ messageId: ref.id, errorCode: errorCode(error) });
        }
      }

      const sentMessages = metadata.filter(
        (message) => isSent(message) && inWindow(message, afterMs, beforeMs),
      );
      sentInWindow += sentMessages.length;
      if (!sentMessages.length) continue;

      const targets = await this.repository.mappedTargets({
        messageIds: [...new Set(sentMessages.map((message) => message.id))],
        threadIds: [...new Set(sentMessages.map((message) => message.threadId))],
      });
      const threadTargets = new Map(targets.byThread);

      for (const message of sentMessages) {
        const existing = targets.byMessage.get(message.id);
        if (existing) {
          alreadyLinked += 1;
          threadTargets.set(message.threadId, existing);
          continue;
        }

        const inherited = threadTargets.get(message.threadId);
        if (inherited) {
          const evidenceCodes = [
            "existing_thread_association",
            "sent_profile_link_sweep",
          ];
          mappings.push({
            messageId: message.id,
            threadId: message.threadId,
            organizationId: inherited.id,
            contactId: null,
            evidenceCodes,
          });
          linked.push({
            messageId: message.id,
            threadId: message.threadId,
            subject: message.headers.subject,
            to: message.headers.to,
            internalDateMs: message.internalDateMs,
            organizationId: inherited.id,
            organizationName: inherited.name,
            evidenceCodes,
          });
          continue;
        }

        try {
          const classification = await classifier.classify(message, client);
          if (classification.outcome === "attached") {
            const evidenceCodes = uniqueEvidence(
              classification.evidenceCodes,
              ["sent_profile_link_sweep"],
            );
            mappings.push({
              messageId: message.id,
              threadId: message.threadId,
              organizationId: classification.organization.id,
              contactId: null,
              evidenceCodes,
            });
            linked.push({
              messageId: message.id,
              threadId: message.threadId,
              subject: message.headers.subject,
              to: message.headers.to,
              internalDateMs: message.internalDateMs,
              organizationId: classification.organization.id,
              organizationName: classification.organization.name,
              evidenceCodes,
            });
            threadTargets.set(message.threadId, classification.organization);
          } else if (classification.outcome === "needs_review") {
            const row = reviewInput(message, classification);
            reviews.push(row);
            needsReview.push({
              messageId: message.id,
              threadId: message.threadId,
              subject: message.headers.subject,
              to: message.headers.to,
              internalDateMs: message.internalDateMs,
              candidates: classification.candidates,
              evidenceCodes: row.evidenceCodes,
            });
          } else {
            ignored.push({
              messageId: message.id,
              threadId: message.threadId,
              subject: message.headers.subject,
              to: message.headers.to,
              internalDateMs: message.internalDateMs,
              evidenceCodes: classification.evidenceCodes,
            });
          }
        } catch (error) {
          failed.push({ messageId: message.id, errorCode: errorCode(error) });
        }
      }
    } while (pageToken);

    if (input.repair) {
      if (mappings.length) await this.repository.upsertMappings(mappings);
      if (reviews.length) await this.repository.upsertReviewItems(reviews);
    }

    const validationStatus = await this.repository.validationStatus();
    return {
      after: input.after.toISOString(),
      before: input.before.toISOString(),
      repair: input.repair,
      validationStatus,
      pagesScanned,
      counts: {
        examined,
        sentInWindow,
        alreadyLinked,
        linked: linked.length,
        needsReview: needsReview.length,
        ignored: ignored.length,
        failed: failed.length,
      },
      linked,
      needsReview,
      ignored,
      failed,
    };
  }
}

export class PostgresGoogleSentProfileLinkSweepRepository
implements GoogleSentProfileLinkSweepRepository {
  private readonly validation: PostgresGoogleValidationRepository;

  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
    validation?: PostgresGoogleValidationRepository,
  ) {
    this.validation = validation ?? new PostgresGoogleValidationRepository(pool);
  }

  private async connectionId(): Promise<string> {
    const result = await this.pool.query(
      `SELECT id
         FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }
    return id;
  }

  async mappedTargets(input: {
    messageIds: string[];
    threadIds: string[];
  }): Promise<GoogleSentProfileLinkTargets> {
    if (!input.messageIds.length && !input.threadIds.length) {
      return { byMessage: new Map(), byThread: new Map() };
    }
    const connectionId = await this.connectionId();
    const result = await this.pool.query(
      `SELECT
         m.message_id,
         m.thread_id,
         o.id::text AS organization_id,
         o.name AS organization_name
       FROM google_workspace_validation_mappings m
       INNER JOIN organizations o
         ON o.id = m.organization_id
        AND o.consolidated_into_id IS NULL
       WHERE m.connection_id = $1
         AND (
           m.message_id = ANY($2::text[])
           OR m.thread_id = ANY($3::text[])
         )
       ORDER BY m.updated_at DESC, m.message_id DESC`,
      [connectionId, input.messageIds, input.threadIds],
    );

    const byMessage = new Map<string, GoogleSentProfileTarget>();
    const threadCandidates = new Map<string, Map<string, GoogleSentProfileTarget>>();
    for (const row of result.rows) {
      if (
        typeof row.message_id !== "string"
        || typeof row.thread_id !== "string"
        || typeof row.organization_id !== "string"
        || typeof row.organization_name !== "string"
      ) {
        continue;
      }
      const target = {
        id: row.organization_id,
        name: row.organization_name,
      };
      byMessage.set(row.message_id, target);
      const candidates = threadCandidates.get(row.thread_id) ?? new Map();
      candidates.set(target.id, target);
      threadCandidates.set(row.thread_id, candidates);
    }

    const byThread = new Map<string, GoogleSentProfileTarget>();
    for (const [threadId, candidates] of threadCandidates) {
      if (candidates.size === 1) {
        byThread.set(threadId, [...candidates.values()][0]!);
      }
    }
    return { byMessage, byThread };
  }

  async upsertMappings(rows: GoogleValidationMappingInput[]): Promise<void> {
    await this.validation.upsertRows(rows);
  }

  async upsertReviewItems(rows: GoogleValidationReviewInput[]): Promise<void> {
    await this.validation.upsertReviewItems(rows);
  }

  async validationStatus(): Promise<GoogleValidationStatus> {
    return this.validation.getStatus();
  }
}
