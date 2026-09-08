import { describe, expect, it, vi } from "vitest";

import { GoogleReviewProfileAssignmentService } from "./google-review-profile-assignment-service";

describe("GoogleReviewProfileAssignmentService", () => {
  it("preflights authorization, then persists before labeling and archiving Gmail", async () => {
    const order: string[] = [];
    const resolve = vi.fn(async () => { order.push("persist"); });
    const assignThread = vi.fn(async () => {
      order.push("gmail");
      return {
        mutationId: "mutation-1",
        state: "completed" as const,
        gmailLabelId: "Label_10",
        gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
        errorCode: null,
      };
    });
    const queries: string[] = [];
    const service = new GoogleReviewProfileAssignmentService({
      reviewPersistence: { resolve },
      matchedPersistence: { assign: vi.fn() },
      pool: {
        async query(text: string) {
          queries.push(text);
          if (text.includes("SELECT item.connection_id")) {
            return {
              rows: [{
                connection_id: "conn-1",
                thread_id: "thread-1",
                decision_revision: "2026-09-08T12:00:00.000Z",
              }],
            };
          }
          order.push("sync-state");
          return { rows: [] };
        },
      },
      mutations: {
        createOrLoad: vi.fn(async () => {
          order.push("queue");
          return {
          id: "mutation-1",
          connectionId: "conn-1",
          messageId: "message-1",
          threadId: "thread-1",
          organizationId: "org-1",
          operation: "assign_thread" as const,
          targetLabelId: null,
          removeLabelIds: [],
          idempotencyKey: "assignment-1",
          state: "pending" as const,
          attemptCount: 0,
          lastErrorCode: null,
        };
        }),
        get: vi.fn(),
        retryNow: vi.fn(),
        claim: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
      },
      syncFactory: async () => {
        order.push("preflight");
        return {
          connectionId: "conn-1",
          service: {
            assignThread,
            labelInboundMessage: vi.fn(),
            retry: vi.fn(),
          },
        };
      },
    });

    await expect(service.resolveReview({
      messageId: "message-1",
      organizationId: "org-1",
      actorId: "owner-1",
      now: new Date("2026-09-08T12:00:00.000Z"),
    })).resolves.toMatchObject({
      threadId: "thread-1",
      gmailSync: { state: "completed" },
    });

    expect(order).toEqual(["persist", "queue", "sync-state", "preflight", "gmail", "sync-state"]);
    expect(assignThread).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "thread-1",
      organizationId: "org-1",
    }));
    expect(queries.at(-1)).toContain("gmail_sync_state");
  });

  it("uses the same sync path for a corrected matched email", async () => {
    const assign = vi.fn(async () => undefined);
    const assignThread = vi.fn(async () => ({
      mutationId: "mutation-1",
      state: "completed" as const,
      gmailLabelId: "Label_10",
      gmailLabelName: "Z - AdventureZone/Profiles/Elko County Fair",
      errorCode: null,
    }));
    const service = new GoogleReviewProfileAssignmentService({
      reviewPersistence: { resolve: vi.fn() },
      matchedPersistence: { assign },
      pool: {
        async query(text: string) {
          return text.includes("SELECT item.connection_id")
            ? {
                rows: [{
                  connection_id: "conn-1",
                  thread_id: "thread-1",
                  decision_revision: "2026-09-08T12:00:00.000Z",
                }],
              }
            : { rows: [] };
        },
      },
      mutations: {
        createOrLoad: vi.fn(async () => {
          id: "mutation-1",
          connectionId: "conn-1",
          messageId: "message-1",
          threadId: "thread-1",
          organizationId: "org-1",
          operation: "assign_thread" as const,
          targetLabelId: null,
          removeLabelIds: [],
          idempotencyKey: "assignment-1",
          state: "pending" as const,
          attemptCount: 0,
          lastErrorCode: null,
        }),
        get: vi.fn(),
        retryNow: vi.fn(),
        claim: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
      },
      syncFactory: async () => ({
        connectionId: "conn-1",
        service: {
          assignThread,
          labelInboundMessage: vi.fn(),
          retry: vi.fn(),
        },
      }),
    });

    await service.assignMatched({
      messageId: "message-1",
      threadId: "thread-1",
      subject: "Fair",
      from: "fair@example.com",
      to: "zone@example.com",
      internalDateMs: 1,
      hasAttachments: false,
      organizationId: "org-1",
      actorId: "owner-1",
      now: new Date("2026-09-08T12:00:00.000Z"),
    });

    expect(assign).toHaveBeenCalledOnce();
    expect(assignThread).toHaveBeenCalledOnce();
  });

  it("persists and queues the assignment before Gmail bootstrap, returning a retryable result when bootstrap fails", async () => {
    const order: string[] = [];
    const resolve = vi.fn(async () => { order.push("persist"); });
    const createOrLoad = vi.fn(async () => {
      order.push("queue");
      return {
        id: "mutation-1",
        connectionId: "conn-1",
        messageId: "message-1",
        threadId: "thread-1",
        organizationId: "org-1",
        operation: "assign_thread" as const,
        targetLabelId: null,
        removeLabelIds: [],
        idempotencyKey: "assignment-1",
        state: "pending" as const,
        attemptCount: 0,
        lastErrorCode: null,
      };
    });
    const fail = vi.fn(async () => { order.push("mark-retryable"); });
    const service = new GoogleReviewProfileAssignmentService({
      reviewPersistence: { resolve },
      matchedPersistence: { assign: vi.fn() },
      mutations: {
        createOrLoad,
        get: vi.fn(),
        retryNow: vi.fn(),
        claim: vi.fn(),
        complete: vi.fn(),
        fail,
      },
      pool: {
        async query(text: string) {
          if (text.includes("SELECT item.connection_id")) {
            order.push("load-decision");
            return {
              rows: [{
                connection_id: "conn-1",
                thread_id: "thread-1",
                decision_revision: "2026-09-08T12:00:00.000Z",
              }],
            };
          }
          order.push("sync-state");
          return { rows: [] };
        },
      },
      syncFactory: async () => {
        order.push("gmail-bootstrap");
        throw new Error("unexpected bootstrap failure");
      },
    });

    await expect(service.resolveReview({
      messageId: "message-1",
      organizationId: "org-1",
      actorId: "owner-1",
      now: new Date("2026-09-08T12:00:00.000Z"),
    })).resolves.toMatchObject({
      threadId: "thread-1",
      gmailSync: {
        mutationId: "mutation-1",
        state: "retryable_error",
        errorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
      },
    });

    expect(order).toEqual([
      "persist",
      "load-decision",
      "queue",
      "sync-state",
      "gmail-bootstrap",
      "mark-retryable",
      "sync-state",
    ]);
  });

});
