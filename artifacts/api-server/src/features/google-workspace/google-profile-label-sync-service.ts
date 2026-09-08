import type { GoogleGmailLabelMutationClient } from "./google-api-types";
import type {
  GoogleGmailMutationIntent,
  GoogleGmailMutationRecord,
  PostgresGoogleGmailMutationRepository,
} from "./google-gmail-mutation-repository";
import type { GoogleProfileLabelRepositoryPort } from "./google-profile-label-repository";
import type { GoogleProfileLabelResolver } from "./google-profile-label-resolver";

export type GoogleProfileLabelSyncResult = {
  mutationId: string;
  state: "completed" | "retryable_error" | "permanent_error" | "conflict";
  gmailLabelId: string | null;
  gmailLabelName: string | null;
  errorCode: string | null;
};

export type GoogleProfileLabelSyncServicePort = {
  assignThread(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
    actorId: string;
    decisionRevision: string;
  }): Promise<GoogleProfileLabelSyncResult>;
  labelInboundMessage(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelSyncResult>;
  retry(mutationId: string): Promise<GoogleProfileLabelSyncResult>;
};

type MutationRepository = Pick<
  PostgresGoogleGmailMutationRepository,
  "createOrLoad" | "get" | "claim" | "complete" | "fail"
>;

function safeCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) return (error as { code: string }).code;
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED";
}

function failureState(code: string): "retryable_error" | "permanent_error" | "conflict" {
  if (code === "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT" ||
      code === "GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT") return "conflict";
  if (code === "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND" ||
      code === "GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND" ||
      code === "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND") return "permanent_error";
  return "retryable_error";
}

export function gmailMutationRetryDelayMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export class GoogleProfileLabelSyncService
implements GoogleProfileLabelSyncServicePort {
  constructor(
    private readonly dependencies: {
      enabled: boolean;
      mutations: MutationRepository;
      resolver: GoogleProfileLabelResolver;
      labels: GoogleProfileLabelRepositoryPort;
      gmail: GoogleGmailLabelMutationClient;
      now?: () => Date;
    },
  ) {}

  async assignThread(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
    actorId: string;
    decisionRevision: string;
  }): Promise<GoogleProfileLabelSyncResult> {
    const intent: GoogleGmailMutationIntent = {
      connectionId: input.connectionId,
      messageId: input.messageId,
      threadId: input.threadId,
      organizationId: input.organizationId,
      operation: "assign_thread",
      idempotencyKey:
        `assign-thread:${input.connectionId}:${input.threadId}:${input.organizationId}:${input.decisionRevision}`,
      actorId: input.actorId,
    };
    return this.start(intent);
  }

  async labelInboundMessage(input: {
    connectionId: string;
    messageId: string;
    threadId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelSyncResult> {
    return this.start({
      ...input,
      operation: "label_inbound_message",
      idempotencyKey:
        `label-inbound:${input.connectionId}:${input.messageId}:${input.organizationId}`,
      actorId: null,
    });
  }

  async retry(mutationId: string): Promise<GoogleProfileLabelSyncResult> {
    const current = await this.dependencies.mutations.get(mutationId);
    if (!current) throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
    return this.execute(current);
  }

  private async start(
    intent: GoogleGmailMutationIntent,
  ): Promise<GoogleProfileLabelSyncResult> {
    const mutation = await this.dependencies.mutations.createOrLoad(intent);
    if (mutation.state === "completed") return this.view(mutation);
    return this.execute(mutation);
  }

  private async execute(
    mutation: GoogleGmailMutationRecord,
  ): Promise<GoogleProfileLabelSyncResult> {
    const now = this.dependencies.now?.() ?? new Date();
    if (!this.dependencies.enabled) {
      await this.dependencies.mutations.fail({
        id: mutation.id,
        state: "retryable_error",
        errorCode: "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_DISABLED",
        nextAttemptAt: null,
        now,
      });
      return {
        mutationId: mutation.id,
        state: "retryable_error",
        gmailLabelId: mutation.targetLabelId,
        gmailLabelName: null,
        errorCode: "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_DISABLED",
      };
    }

    const claimed = await this.dependencies.mutations.claim(mutation.id, now);
    if (!claimed) {
      const current = await this.dependencies.mutations.get(mutation.id);
      if (!current) throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
      return this.view(current);
    }

    try {
      const resolution = await this.dependencies.resolver.resolve({
        connectionId: claimed.connectionId,
        organizationId: claimed.organizationId,
      });
      if (resolution.status === "conflict") {
        await this.dependencies.mutations.fail({
          id: claimed.id,
          state: "conflict",
          errorCode: resolution.code,
          nextAttemptAt: null,
          now,
        });
        return {
          mutationId: claimed.id,
          state: "conflict",
          gmailLabelId: null,
          gmailLabelName: null,
          errorCode: resolution.code,
        };
      }

      const target = resolution.mapping;
      let removeLabelIds: string[] = [];
      if (claimed.operation === "assign_thread") {
        const managed = await this.dependencies.labels.listManagedLabelIds(
          claimed.connectionId,
        );
        removeLabelIds = [...new Set([
          ...managed.filter((id) => id !== target.gmailLabelId),
          "INBOX",
        ])].sort();
        await this.dependencies.gmail.modifyThreadLabels({
          threadId: claimed.threadId,
          addLabelIds: [target.gmailLabelId],
          removeLabelIds,
        });
      } else {
        await this.dependencies.gmail.modifyMessageLabels({
          messageId: claimed.messageId,
          addLabelIds: [target.gmailLabelId],
          removeLabelIds: [],
        });
      }

      await this.dependencies.mutations.complete({
        id: claimed.id,
        targetLabelId: target.gmailLabelId,
        removeLabelIds,
        now,
      });
      return {
        mutationId: claimed.id,
        state: "completed",
        gmailLabelId: target.gmailLabelId,
        gmailLabelName: target.gmailLabelName,
        errorCode: null,
      };
    } catch (error) {
      const code = safeCode(error);
      const state = failureState(code);
      await this.dependencies.mutations.fail({
        id: claimed.id,
        state,
        errorCode: code,
        nextAttemptAt:
          state === "retryable_error"
            ? new Date(now.getTime() + gmailMutationRetryDelayMs(claimed.attemptCount))
            : null,
        now,
      });
      return {
        mutationId: claimed.id,
        state,
        gmailLabelId: claimed.targetLabelId,
        gmailLabelName: null,
        errorCode: code,
      };
    }
  }

  private view(mutation: GoogleGmailMutationRecord): GoogleProfileLabelSyncResult {
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
}
