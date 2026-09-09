import type { GoogleGmailLabelMutationClient } from "./google-api-types";
import type {
  GoogleGmailMutationIntent,
  GoogleGmailMutationRecord,
  PostgresGoogleGmailMutationRepository,
} from "./google-gmail-mutation-repository";
import { isProfileLabelPath } from "./google-profile-label-config";
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
  | "createOrLoad"
  | "get"
  | "retryNow"
  | "claim"
  | "complete"
  | "fail"
  | "withThreadLock"
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
        `assign-thread:${input.connectionId}:${input.threadId}:${input.organizationId}`,
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
    const now = this.dependencies.now?.() ?? new Date();
    const queued = await this.dependencies.mutations.retryNow(mutationId, now);
    const current = queued ?? await this.dependencies.mutations.get(mutationId);
    if (!current) throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
    return this.execute(current);
  }

  private async start(
    intent: GoogleGmailMutationIntent,
  ): Promise<GoogleProfileLabelSyncResult> {
    const mutation = await this.dependencies.mutations.createOrLoad(intent);
    if (mutation.state === "completed") {
      return this.reconcileCompleted(mutation);
    }
    return this.execute(mutation);
  }

  private async execute(
    mutation: GoogleGmailMutationRecord,
  ): Promise<GoogleProfileLabelSyncResult> {
    const now = this.dependencies.now?.() ?? new Date();
    if (!this.dependencies.enabled) {
      const winner = await this.dependencies.mutations.fail({
        id: mutation.id,
        state: "retryable_error",
        errorCode: "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_DISABLED",
        nextAttemptAt: null,
        now,
      });
      if (winner?.state === "completed") return this.view(winner);
      return {
        mutationId: mutation.id,
        state: "retryable_error",
        gmailLabelId: mutation.targetLabelId,
        gmailLabelName: null,
        errorCode: "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_DISABLED",
      };
    }

    return this.dependencies.mutations.withThreadLock(
      {
        connectionId: mutation.connectionId,
        threadId: mutation.threadId,
      },
      async () => {
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
        const winner = await this.dependencies.mutations.fail({
          id: claimed.id,
          expectedAttemptCount: claimed.attemptCount,
          state: "conflict",
          errorCode: resolution.code,
          nextAttemptAt: null,
          now,
        });
        if (winner?.state === "completed") return this.view(winner);
        return {
          mutationId: claimed.id,
          state: "conflict",
          gmailLabelId: null,
          gmailLabelName: null,
          errorCode: resolution.code,
        };
      }

      const target = resolution.mapping;
      const removeLabelIds = await this.applyCurrentProfileLabel({
        mutation: claimed,
        targetLabelId: target.gmailLabelId,
        onlyWhenChanged: false,
      });

      const winner = await this.dependencies.mutations.complete({
        id: claimed.id,
        expectedAttemptCount: claimed.attemptCount,
        targetLabelId: target.gmailLabelId,
        removeLabelIds,
        now,
      });
      if (!winner) {
        throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND");
      }
      if (winner.state !== "completed") return this.view(winner);
      return {
        ...this.view(winner),
        gmailLabelName: target.gmailLabelName,
      };
    } catch (error) {
      const code = safeCode(error);
      const state = failureState(code);
      const winner = await this.dependencies.mutations.fail({
        id: claimed.id,
        expectedAttemptCount: claimed.attemptCount,
        state,
        errorCode: code,
        nextAttemptAt:
          state === "retryable_error"
            ? new Date(now.getTime() + gmailMutationRetryDelayMs(claimed.attemptCount))
            : null,
        now,
      });
      if (winner?.state === "completed") return this.view(winner);
      return {
        mutationId: claimed.id,
        state,
        gmailLabelId: claimed.targetLabelId,
        gmailLabelName: null,
        errorCode: code,
      };
        }
      },
    );
  }

  private async reconcileCompleted(
    mutation: GoogleGmailMutationRecord,
  ): Promise<GoogleProfileLabelSyncResult> {
    if (!this.dependencies.enabled) return this.view(mutation);
    return this.dependencies.mutations.withThreadLock(
      {
        connectionId: mutation.connectionId,
        threadId: mutation.threadId,
      },
      async () => {
        const resolution = await this.dependencies.resolver.resolve({
          connectionId: mutation.connectionId,
          organizationId: mutation.organizationId,
        });
        if (resolution.status === "conflict") {
          return {
            mutationId: mutation.id,
            state: "conflict",
            gmailLabelId: null,
            gmailLabelName: null,
            errorCode: resolution.code,
          };
        }
        await this.applyCurrentProfileLabel({
          mutation,
          targetLabelId: resolution.mapping.gmailLabelId,
          onlyWhenChanged: true,
        });
        return {
          ...this.view(mutation),
          gmailLabelId: resolution.mapping.gmailLabelId,
          gmailLabelName: resolution.mapping.gmailLabelName,
        };
      },
    );
  }

  private async applyCurrentProfileLabel(input: {
    mutation: GoogleGmailMutationRecord;
    targetLabelId: string;
    onlyWhenChanged: boolean;
  }): Promise<string[]> {
    const [managedLabelIds, gmailLabels, attachedLabelIds] = await Promise.all([
      this.dependencies.labels.listManagedLabelIds(input.mutation.connectionId),
      this.dependencies.gmail.listLabels(),
      this.dependencies.gmail.getThreadLabelIds(input.mutation.threadId),
    ]);
    const attached = new Set(attachedLabelIds);
    const profileLabelIds = new Set([
      ...managedLabelIds,
      ...gmailLabels
        .filter((label) =>
          label.type === "user" && isProfileLabelPath(label.name)
        )
        .map((label) => label.id),
    ]);
    const removeLabelIds = [...profileLabelIds]
      .filter((labelId) =>
        labelId !== input.targetLabelId && attached.has(labelId)
      );
    if (
      input.mutation.operation === "assign_thread" &&
      attached.has("INBOX")
    ) {
      removeLabelIds.push("INBOX");
    }
    removeLabelIds.sort();

    if (
      !input.onlyWhenChanged ||
      !attached.has(input.targetLabelId) ||
      removeLabelIds.length
    ) {
      await this.dependencies.gmail.modifyThreadLabels({
        threadId: input.mutation.threadId,
        addLabelIds: [input.targetLabelId],
        removeLabelIds,
      });
    }
    return removeLabelIds;
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
