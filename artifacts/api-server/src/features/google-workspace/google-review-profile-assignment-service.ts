import { pool as defaultPool } from "@workspace/db";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import { PostgresGoogleGmailMutationRepository } from "./google-gmail-mutation-repository";
import { GoogleMatchedEmailCorrectionService } from "./google-matched-email-correction-service";
import { readGoogleProfileLabelConfig } from "./google-profile-label-config";
import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";
import { GoogleProfileLabelResolver } from "./google-profile-label-resolver";
import {
  GoogleProfileLabelSyncService,
  type GoogleProfileLabelSyncResult,
  type GoogleProfileLabelSyncServicePort,
} from "./google-profile-label-sync-service";
import { GoogleReviewAssignmentDiagnosticService } from "./google-review-assignment-diagnostic-service";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

type BaseInput = {
  messageId: string;
  organizationId: string;
  actorId: string;
  now: Date;
};

type MatchedInput = BaseInput & {
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
};

export type GoogleReviewAssignmentView = {
  organizationId: string;
  threadId: string;
  gmailSync: GoogleProfileLabelSyncResult;
};

type ReviewPersistence = {
  resolve(input: BaseInput): Promise<void>;
};

type MatchedPersistence = {
  assign(input: MatchedInput): Promise<void>;
};

type SyncFactory = () => Promise<{
  connectionId: string;
  service: GoogleProfileLabelSyncServicePort;
}>;

export class GoogleReviewProfileAssignmentService {
  private readonly pool: SqlPool;
  private readonly reviewPersistence: ReviewPersistence;
  private readonly matchedPersistence: MatchedPersistence;
  private readonly syncFactory: SyncFactory;

  constructor(input: {
    pool?: SqlPool;
    reviewPersistence?: ReviewPersistence;
    matchedPersistence?: MatchedPersistence;
    syncFactory?: SyncFactory;
  } = {}) {
    this.pool = input.pool ?? (defaultPool as unknown as SqlPool);
    this.reviewPersistence =
      input.reviewPersistence ?? new GoogleReviewAssignmentDiagnosticService();
    this.matchedPersistence =
      input.matchedPersistence ?? new GoogleMatchedEmailCorrectionService();
    this.syncFactory = input.syncFactory ?? (() => this.createProductionSync());
  }

  async resolveReview(input: BaseInput): Promise<GoogleReviewAssignmentView> {
    const production = await this.syncFactory();
    await this.reviewPersistence.resolve(input);
    return this.syncSavedDecision(input, production);
  }

  async assignMatched(input: MatchedInput): Promise<GoogleReviewAssignmentView> {
    const production = await this.syncFactory();
    await this.matchedPersistence.assign(input);
    return this.syncSavedDecision(input, production);
  }

  async retryGmailMutation(
    mutationId: string,
    now: Date = new Date(),
  ): Promise<GoogleProfileLabelSyncResult> {
    const mutations = new PostgresGoogleGmailMutationRepository(this.pool);
    const mutation = await mutations.get(mutationId);
    if (!mutation) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
    }
    const production = await this.syncFactory();
    if (production.connectionId !== mutation.connectionId) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    }
    const gmailSync = await production.service.retry(mutationId);
    await this.pool.query(
      `UPDATE google_workspace_validation_review_items
          SET gmail_sync_state = $3,
              gmail_sync_error_code = $4,
              updated_at = GREATEST(updated_at, $5)
        WHERE connection_id = $1
          AND gmail_sync_mutation_id = $2`,
      [
        mutation.connectionId,
        mutationId,
        gmailSync.state,
        gmailSync.errorCode,
        now,
      ],
    );
    return gmailSync;
  }

  private async syncSavedDecision(
    input: BaseInput,
    production: {
      connectionId: string;
      service: GoogleProfileLabelSyncServicePort;
    },
  ): Promise<GoogleReviewAssignmentView> {
    const result = await this.pool.query(
      `SELECT item.connection_id::text,
              item.thread_id,
              item.updated_at::text AS decision_revision
         FROM google_workspace_validation_review_items item
        WHERE item.message_id = $1
          AND item.resolved_organization_id = $2
          AND item.review_state = 'resolved'
        ORDER BY item.updated_at DESC
        LIMIT 1`,
      [input.messageId, input.organizationId],
    );
    const row = result.rows[0];
    if (
      !row ||
      typeof row.connection_id !== "string" ||
      typeof row.thread_id !== "string" ||
      typeof row.decision_revision !== "string"
    ) throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");

    if (production.connectionId !== row.connection_id) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    }
    const gmailSync = await production.service.assignThread({
      connectionId: row.connection_id,
      messageId: input.messageId,
      threadId: row.thread_id,
      organizationId: input.organizationId,
      actorId: input.actorId,
      decisionRevision: row.decision_revision,
    });
    await this.pool.query(
      `UPDATE google_workspace_validation_review_items
          SET gmail_sync_state = $3,
              gmail_sync_error_code = $4,
              gmail_sync_mutation_id = $5,
              updated_at = GREATEST(updated_at, $6)
        WHERE connection_id = $1 AND message_id = $2`,
      [
        row.connection_id,
        input.messageId,
        gmailSync.state,
        gmailSync.errorCode,
        gmailSync.mutationId,
        input.now,
      ],
    );
    return {
      organizationId: input.organizationId,
      threadId: row.thread_id,
      gmailSync,
    };
  }

  private async createProductionSync(): Promise<{
    connectionId: string;
    service: GoogleProfileLabelSyncServicePort;
  }> {
    const connection = await new PostgresGoogleConnectionRepository({
      pool: this.pool as never,
    }).createGmailLabelMutationClient();
    if (!connection) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    const labels = new PostgresGoogleProfileLabelRepository(this.pool);
    const mutations = new PostgresGoogleGmailMutationRepository(this.pool);
    const resolver = new GoogleProfileLabelResolver(labels, connection.client);
    return {
      connectionId: connection.connectionId,
      service: new GoogleProfileLabelSyncService({
        enabled: readGoogleProfileLabelConfig().enabled,
        labels,
        mutations,
        resolver,
        gmail: connection.client,
      }),
    };
  }
}
