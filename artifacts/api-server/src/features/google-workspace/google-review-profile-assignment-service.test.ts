import { describe, expect, it, vi } from "vitest";

import type { GoogleGmailMutationRecord } from "./google-gmail-mutation-repository";
import type { CommittedProfileAssignment } from "./google-profile-assignment-transaction";
import { GoogleReviewProfileAssignmentService } from "./google-review-profile-assignment-service";

const mutation: GoogleGmailMutationRecord = {
  id: "mutation-1",
  connectionId: "conn-1",
  messageId: "message-1",
  threadId: "thread-1",
  organizationId: "org-1",
  operation: "assign_thread",
  targetLabelId: null,
  removeLabelIds: [],
  idempotencyKey: "assign-thread:conn-1:thread-1:org-1",
  state: "pending",
  attemptCount: 0,
  intentGeneration: 1,
  lastErrorCode: null,
};

const committed: CommittedProfileAssignment = {
  connectionId: "conn-1",
  messageId: "message-1",
  threadId: "thread-1",
  organizationId: "org-1",
  mutation,
};

function baseInput() {
  return {
    messageId: "message-1",
    organizationId: "org-1",
    actorId: "owner-1",
    now: new Date("2026-09-08T12:00:00.000Z"),
  };
}

function harness(options?: {
  archiver?: any;
  bootstrapError?: Error;
  projectionError?: Error;
  failWinner?: GoogleGmailMutationRecord;
}) {
  const order: string[] = [];
  const assignmentPersistence = {
    resolveReview: vi.fn(async () => {
      order.push("transaction");
      return committed;
    }),
    assignMatched: vi.fn(async () => {
      order.push("transaction");
      return committed;
    }),
  };
  const gmailSync = {
    mutationId: "mutation-1",
    state: "completed" as const,
    gmailLabelId: "Label_10",
    gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
    errorCode: null,
  };
  const retry = vi.fn(async () => {
    order.push("gmail");
    return gmailSync;
  });
  const fail = vi.fn(async () => {
    order.push("mark-retryable");
    return options?.failWinner ?? {
      ...mutation,
      state: "retryable_error" as const,
      lastErrorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
    };
  });
  const query = vi.fn(async () => {
    order.push("projection");
    if (options?.projectionError) throw options.projectionError;
    return { rows: [] };
  });
  const service = new GoogleReviewProfileAssignmentService({
    assignmentPersistence,
    ...(options?.archiver ? {archiver:options.archiver}:{}),
    mutations: {
      get: vi.fn(async () => mutation),
      fail,
    },
    pool: {
      query,
      connect: vi.fn(async () => {
        throw new Error("unused");
      }),
    },
    syncFactory: async () => {
      order.push("bootstrap");
      if (options?.bootstrapError) throw options.bootstrapError;
      return {
        connectionId: "conn-1",
        service: {
          assignThread: vi.fn(),
          labelInboundMessage: vi.fn(),
          retry,
        },
      };
    },
  });
  return { service, assignmentPersistence, retry, fail, query, order };
}

describe("GoogleReviewProfileAssignmentService", () => {
  it("commits the assignment before Gmail bootstrap and execution", async () => {
    const h = harness();

    await expect(h.service.resolveReview(baseInput())).resolves.toMatchObject({
      threadId: "thread-1",
      gmailSync: { state: "completed" },
    });

    expect(h.order).toEqual(["transaction", "bootstrap", "gmail", "projection"]);
    expect(h.retry).toHaveBeenCalledWith("mutation-1");
  });

  it("uses the same atomic path for a corrected matched email", async () => {
    const h = harness();

    await h.service.assignMatched({
      ...baseInput(),
      threadId: "thread-1",
      subject: "Fair",
      from: "fair@example.com",
      to: "zone@example.com",
      internalDateMs: 1,
      hasAttachments: false,
    });

    expect(h.assignmentPersistence.assignMatched).toHaveBeenCalledOnce();
    expect(h.retry).toHaveBeenCalledWith("mutation-1");
  });

  it("returns a retryable committed mutation when Gmail bootstrap fails", async () => {
    const h = harness({ bootstrapError: new Error("unexpected bootstrap failure") });

    await expect(h.service.resolveReview(baseInput())).resolves.toMatchObject({
      threadId: "thread-1",
      gmailSync: {
        mutationId: "mutation-1",
        state: "retryable_error",
        errorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
      },
    });
    expect(h.order).toEqual([
      "transaction",
      "bootstrap",
      "mark-retryable",
      "projection",
    ]);
  });

  it("does not downgrade Gmail completion when the review projection fails", async () => {
    const h = harness({ projectionError: new Error("projection unavailable") });

    await expect(h.service.resolveReview(baseInput())).resolves.toMatchObject({
      gmailSync: {
        mutationId: "mutation-1",
        state: "completed",
        gmailLabelId: "Label_10",
        errorCode: null,
      },
    });
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(String(h.query.mock.calls[0]?.[0])).toContain(
      "gmail_sync_mutation_id = $5",
    );
    expect(String(h.query.mock.calls[0]?.[0])).toContain(
      "google_workspace_gmail_thread_intents",
    );
    expect(h.query.mock.calls[0]?.[1]?.[6]).toBe("org-1");
    expect(h.fail).not.toHaveBeenCalled();
  });

  it("returns a concurrent completed winner after bootstrap failure", async () => {
    const h = harness({
      bootstrapError: new Error("unexpected bootstrap failure"),
      failWinner: {
        ...mutation,
        state: "completed",
        targetLabelId: "Label_10",
      },
    });

    await expect(h.service.resolveReview(baseInput())).resolves.toMatchObject({
      gmailSync: {
        state: "completed",
        gmailLabelId: "Label_10",
        errorCode: null,
      },
    });
  });

  it("does not bootstrap Gmail for an already completed committed mutation", async () => {
    const h = harness();
    h.assignmentPersistence.resolveReview.mockResolvedValueOnce({
      ...committed,
      mutation: { ...mutation, state: "completed", targetLabelId: "Label_10" },
    });

    await expect(h.service.resolveReview(baseInput())).resolves.toMatchObject({
      gmailSync: { state: "completed", gmailLabelId: "Label_10" },
    });
    expect(h.order).toEqual([]);
    expect(h.assignmentPersistence.resolveReview).toHaveBeenCalledOnce();
    expect(h.retry).not.toHaveBeenCalled();
  });
});

it("keeps a failed refresh of previously complete history retryable",async()=>{
 const archiver={archiveApprovedThread:vi.fn(async()=>({id:"archive",archiveState:"complete",lastGmailErrorCode:"GOOGLE_WORKSPACE_REFRESH_FAILED",messages:[]}))};
 const {service}=harness({archiver});
 const result=await service.synchronizeAttention(committed,async()=>{});
 expect(result.archiveSync.state).toBe("retry_required");
 expect(result.archiveSync.errorCode).toBe("GOOGLE_WORKSPACE_REFRESH_FAILED");
});

it("retries only Gmail when the same decision already has complete history",async()=>{
 const archiver={archiveApprovedThread:vi.fn()};
 const {service,retry}=harness({archiver});
 const result=await service.synchronizeAttention(committed,async()=>{}, {gmailSync:{state:"retry_required",errorCode:"error"},archiveSync:{state:"complete",conversationId:"archive",errorCode:null}});
 expect(retry).toHaveBeenCalledOnce();expect(archiver.archiveApprovedThread).not.toHaveBeenCalled();
 expect(result.archiveSync.conversationId).toBe("archive");
});
