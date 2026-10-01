import type { AttentionSync } from "./email-thread-attention-service";
import { attentionLabelHandler } from "./email-thread-attention-sync";
import { pool as defaultPool } from "@workspace/db";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import { GoogleProfileEmailArchiveService } from "./google-profile-email-archive-service";
import type { ArchivedProfileEmailThread } from "./google-profile-email-archive-types";
import {
  PostgresGoogleGmailMutationRepository,
  type GoogleGmailMutationRecord,
} from "./google-gmail-mutation-repository";
import {
  PostgresGoogleProfileAssignmentTransaction,
  type BaseAssignmentInput,
  type CommittedProfileAssignment,
  type GoogleProfileAssignmentTransactionPort,
  type MatchedAssignmentInput,
} from "./google-profile-assignment-transaction";
import { readGoogleProfileLabelConfig } from "./google-profile-label-config";
import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";
import { GoogleProfileLabelResolver } from "./google-profile-label-resolver";
import {
  GoogleProfileLabelSyncService,
  type GoogleProfileLabelSyncResult,
  type GoogleProfileLabelSyncServicePort,
} from "./google-profile-label-sync-service";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect(): Promise<SqlClient>;
};

export type GoogleReviewAssignmentView = {
  organizationId: string;
  threadId: string;
  gmailSync: GoogleProfileLabelSyncResult;
  archiveSync: {
    conversationId: string | null;
    state: "complete" | "partial" | "pending" | "retry_required";
    errorCode: string | null;
  };
};

type ArchiveAccess = {
  archiveApprovedThread(input: {
    organizationId: string;
    contactId: string | null;
    gmailThreadId: string;
  }): Promise<ArchivedProfileEmailThread>;
};

type MutationRepository = Pick<
  PostgresGoogleGmailMutationRepository,
  "get" | "fail"
>;

function gmailFailureCode(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : error instanceof Error
        ? error.message
        : null;
  return typeof code === "string" && code.startsWith("GOOGLE_WORKSPACE_")
    ? code
    : "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED";
}

function mutationView(
  mutation: GoogleGmailMutationRecord,
): GoogleProfileLabelSyncResult {
  const state =
    mutation.state === "completed" ||
    mutation.state === "retryable_error" ||
    mutation.state === "permanent_error" ||
    mutation.state === "conflict"
      ? mutation.state
      : "retryable_error";
  return {
    mutationId: mutation.id,
    state,
    gmailLabelId: mutation.targetLabelId,
    gmailLabelName: null,
    errorCode:
      mutation.lastErrorCode ??
      (state === "retryable_error"
        ? "GOOGLE_WORKSPACE_GMAIL_MUTATION_IN_PROGRESS"
        : null),
  };
}

type SyncFactory = () => Promise<{
  connectionId: string;
  service: GoogleProfileLabelSyncServicePort;
}>;

export class GoogleReviewProfileAssignmentService {
  private readonly pool: SqlPool;
  private readonly assignmentPersistence: GoogleProfileAssignmentTransactionPort;
  private readonly syncFactory: SyncFactory;
  private readonly mutations: MutationRepository;
  private readonly archiver: ArchiveAccess;

  constructor(input: {
    pool?: SqlPool;
    assignmentPersistence?: GoogleProfileAssignmentTransactionPort;
    syncFactory?: SyncFactory;
    mutations?: MutationRepository;
    archiver?: ArchiveAccess;
  } = {}) {
    this.pool = input.pool ?? (defaultPool as unknown as SqlPool);
    this.assignmentPersistence =
      input.assignmentPersistence ??
      new PostgresGoogleProfileAssignmentTransaction(this.pool);
    this.syncFactory = input.syncFactory ?? (() => this.createProductionSync());
    this.mutations =
      input.mutations ?? new PostgresGoogleGmailMutationRepository(this.pool);
    this.archiver =
      input.archiver ??
      (Object.keys(input).length
        ? {
            archiveApprovedThread: async () => {
              throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_UNAVAILABLE");
            },
          }
        : new GoogleProfileEmailArchiveService());
  }

  async resolveReview(
    input: BaseAssignmentInput,
  ): Promise<GoogleReviewAssignmentView> {
    const committed = await this.assignmentPersistence.resolveReview(input);
    const result = await this.executeCommitted(input, committed);
    return this.withArchive(result, committed);
  }

  async assignMatched(
    input: MatchedAssignmentInput,
  ): Promise<GoogleReviewAssignmentView> {
    const committed = await this.assignmentPersistence.assignMatched(input);
    const result = await this.executeCommitted(input, committed);
    return this.withArchive(result, committed);
  }

  async synchronizeAttention(committed: CommittedProfileAssignment, authorize: () => Promise<void>, prior?: AttentionSync): Promise<AttentionSync> {
    await authorize();
    let gmailSync=prior?.gmailSync;
    if(gmailSync?.state!=="completed") {
      try { gmailSync=await this.retryGmailMutation(committed.mutation.id); }
      catch(error){gmailSync={state:"retry_required",errorCode:gmailFailureCode(error)};}
    }
    await authorize();
    let archiveSync=prior?.archiveSync;
    if(archiveSync?.state!=="complete") {
      try {
        const archived=await this.archiver.archiveApprovedThread({organizationId:committed.organizationId,contactId:null,gmailThreadId:committed.threadId});
        const covered=archived.messages.some(message=>message.gmailMessageId===committed.messageId);
        const errorCode=archived.lastGmailErrorCode??(!covered?"GOOGLE_WORKSPACE_ARCHIVE_SOURCE_MISSING":null);
        archiveSync={conversationId:archived.id,state:errorCode?"retry_required":archived.archiveState,errorCode};
      }catch(error){archiveSync={conversationId:null,state:"retry_required",errorCode:gmailFailureCode(error)};}
    }
    return {gmailSync,archiveSync};
  }

  async retryGmailMutation(
    mutationId: string,
    now: Date = new Date(),
  ): Promise<GoogleProfileLabelSyncResult> {
    const mutation = await this.mutations.get(mutationId);
    if (!mutation) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
    }
    const production = await this.syncFactory();
    if (production.connectionId !== mutation.connectionId) {
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    }
    const gmailSync = await production.service.retry(mutationId);
    await this.writeSyncStateBestEffort({
      connectionId: mutation.connectionId,
      messageId: mutation.messageId,
      state: gmailSync.state,
      errorCode: gmailSync.errorCode,
      mutationId: gmailSync.mutationId,
      organizationId: mutation.organizationId,
      now,
    });
    return gmailSync;
  }

  private async executeCommitted(
    input: BaseAssignmentInput,
    committed: CommittedProfileAssignment,
  ): Promise<GoogleReviewAssignmentView> {
    if (committed.mutation.state === "completed") {
      return this.result(committed, mutationView(committed.mutation));
    }

    let production: Awaited<ReturnType<SyncFactory>>;
    try {
      production = await this.syncFactory();
    } catch (error) {
      return this.markQueuedFailure(input, committed, error);
    }
    if (production.connectionId !== committed.connectionId) {
      return this.markQueuedFailure(
        input,
        committed,
        new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED"),
      );
    }

    let gmailSync: GoogleProfileLabelSyncResult;
    try {
      gmailSync = await production.service.retry(committed.mutation.id);
    } catch (error) {
      return this.markQueuedFailure(input, committed, error);
    }

    await this.writeSyncStateBestEffort({
      connectionId: committed.connectionId,
      messageId: committed.messageId,
      state: gmailSync.state,
      errorCode: gmailSync.errorCode,
      mutationId: gmailSync.mutationId,
      organizationId: committed.organizationId,
      now: input.now,
    });
    return this.result(committed, gmailSync);
  }

  private async markQueuedFailure(
    input: BaseAssignmentInput,
    committed: CommittedProfileAssignment,
    error: unknown,
  ): Promise<GoogleReviewAssignmentView> {
    const code = gmailFailureCode(error);
    const winner = await this.mutations.fail({
      id: committed.mutation.id,
      state: "retryable_error",
      errorCode: code,
      nextAttemptAt: null,
      now: input.now,
    });
    const gmailSync =
      winner?.state === "completed"
        ? mutationView(winner)
        : {
            mutationId: committed.mutation.id,
            state: "retryable_error" as const,
            gmailLabelId: committed.mutation.targetLabelId,
            gmailLabelName: null,
            errorCode: code,
          };
    await this.writeSyncStateBestEffort({
      connectionId: committed.connectionId,
      messageId: committed.messageId,
      state: gmailSync.state,
      errorCode: gmailSync.errorCode,
      mutationId: gmailSync.mutationId,
      organizationId: committed.organizationId,
      now: input.now,
    });
    return this.result(committed, gmailSync);
  }

  private result(
    committed: CommittedProfileAssignment,
    gmailSync: GoogleProfileLabelSyncResult,
  ): GoogleReviewAssignmentView {
    return {
      organizationId: committed.organizationId,
      threadId: committed.threadId,
      gmailSync,
      archiveSync: {
        conversationId: null,
        state: "pending",
        errorCode: null,
      },
    };
  }

  private async withArchive(
    result: GoogleReviewAssignmentView,
    committed: CommittedProfileAssignment,
  ): Promise<GoogleReviewAssignmentView> {
    try {
      const archived = await this.archiver.archiveApprovedThread({
        organizationId: committed.organizationId,
        contactId: null,
        gmailThreadId: committed.threadId,
      });
      return {
        ...result,
        archiveSync: {
          conversationId: archived.id,
          state: archived.archiveState,
          errorCode: null,
        },
      };
    } catch (error) {
      return {
        ...result,
        archiveSync: {
          conversationId: null,
          state: "retry_required",
          errorCode: gmailFailureCode(error),
        },
      };
    }
  }

  private async writeSyncStateBestEffort(input: {
    connectionId: string;
    messageId: string;
    state: string;
    errorCode: string | null;
    mutationId: string;
    organizationId: string;
    now: Date;
  }): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.pool.query(
          `UPDATE google_workspace_validation_review_items
              SET gmail_sync_state = $3,
                  gmail_sync_error_code = $4,
                  gmail_sync_mutation_id = $5,
                  updated_at = GREATEST(updated_at, $6)
            WHERE connection_id = $1
              AND message_id = $2
              AND review_state = 'resolved'
              AND resolved_organization_id = $7
              AND gmail_sync_mutation_id = $5
              AND EXISTS (
                SELECT 1
                  FROM google_workspace_gmail_thread_intents intent
                 WHERE intent.connection_id = $1
                   AND intent.thread_id =
                     google_workspace_validation_review_items.thread_id
                   AND intent.intent_kind = 'assign'
                   AND intent.organization_id = $7
                   AND intent.current_mutation_id = $5
              )`,
          [
            input.connectionId,
            input.messageId,
            input.state,
            input.errorCode,
            input.mutationId,
            input.now,
            input.organizationId,
          ],
        );
        return;
      } catch {
        // The mutation table is authoritative; one retry is enough here.
      }
    }
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
        attention: attentionLabelHandler(this.pool as never, connection.client),
      }),
    };
  }
}
