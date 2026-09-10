import { describe, expect, it, vi } from "vitest";

import type { GoogleGmailMutationRecord } from "./google-gmail-mutation-repository";
import { GoogleReviewProfileAssignmentService } from "./google-review-profile-assignment-service";

const mutation: GoogleGmailMutationRecord = {
  id: "mutation-1",
  connectionId: "connection-1",
  messageId: "message-1",
  threadId: "thread-1",
  organizationId: "org-1",
  operation: "assign_thread",
  targetLabelId: null,
  removeLabelIds: [],
  idempotencyKey: "assignment",
  state: "completed",
  attemptCount: 1,
  intentGeneration: 1,
  lastErrorCode: null,
};

describe("Google review assignment durable archive", () => {
  it("archives the thread after the profile assignment commits, including already-completed Gmail mutations", async () => {
    const archiveApprovedThread = vi.fn(async () => ({
      id: "conversation-1",
      organizationId: "org-1",
      contactId: null,
      subject: "Fair",
      originalGmailUrl: null,
      providerThreadIds: ["thread-1"],
      archiveState: "complete" as const,
      lastSyncedAt: "2026-09-09T12:00:00.000Z",
      lastGmailErrorCode: null,
      messages: [],
    }));
    const service = new GoogleReviewProfileAssignmentService({
      assignmentPersistence: {
        resolveReview: async () => ({
          connectionId: "connection-1",
          messageId: "message-1",
          threadId: "thread-1",
          organizationId: "org-1",
          mutation,
        }),
        assignMatched: vi.fn(),
      },
      archiver: { archiveApprovedThread },
      mutations: {
        get: vi.fn(),
        fail: vi.fn(),
      },
      pool: {
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(),
      } as never,
      syncFactory: vi.fn(),
    });

    const result = await service.resolveReview({
      messageId: "message-1",
      organizationId: "org-1",
      actorId: "owner",
      now: new Date("2026-09-09T12:00:00.000Z"),
    });

    expect(archiveApprovedThread).toHaveBeenCalledWith({
      organizationId: "org-1",
      contactId: null,
      gmailThreadId: "thread-1",
    });
    expect(result.archiveSync).toEqual({
      conversationId: "conversation-1",
      state: "complete",
      errorCode: null,
    });
  });

  it("keeps the committed assignment usable and reports a retryable archive failure", async () => {
    const service = new GoogleReviewProfileAssignmentService({
      assignmentPersistence: {
        resolveReview: async () => ({
          connectionId: "connection-1",
          messageId: "message-1",
          threadId: "thread-1",
          organizationId: "org-1",
          mutation,
        }),
        assignMatched: vi.fn(),
      },
      archiver: {
        archiveApprovedThread: async () => {
          throw new Error("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
        },
      },
      mutations: {
        get: vi.fn(),
        fail: vi.fn(),
      },
      pool: {
        query: vi.fn(async () => ({ rows: [] })),
        connect: vi.fn(),
      } as never,
      syncFactory: vi.fn(),
    });

    await expect(service.resolveReview({
      messageId: "message-1",
      organizationId: "org-1",
      actorId: "owner",
      now: new Date("2026-09-09T12:00:00.000Z"),
    })).resolves.toMatchObject({
      organizationId: "org-1",
      threadId: "thread-1",
      gmailSync: { state: "completed" },
      archiveSync: {
        conversationId: null,
        state: "retry_required",
        errorCode: "GOOGLE_WORKSPACE_API_REQUEST_FAILED",
      },
    });
  });
});
