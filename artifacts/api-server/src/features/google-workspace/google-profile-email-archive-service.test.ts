import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleProfileEmailArchiveService } from "./google-profile-email-archive-service";
import type { ArchivedProfileEmailThread } from "./google-profile-email-archive-types";

function client(overrides: Partial<GoogleWorkspaceReadClient>): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    ...overrides,
  };
}

function archived(overrides: Partial<ArchivedProfileEmailThread> = {}): ArchivedProfileEmailThread {
  return {
    id: "conversation-1",
    organizationId: "org-1",
    contactId: "contact-1",
    subject: "Spring fair",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
    providerThreadIds: ["thread-1"],
    archiveState: "complete",
    lastSyncedAt: "2026-09-09T12:00:00.000Z",
    lastGmailErrorCode: null,
    messages: [],
    ...overrides,
  };
}

describe("GoogleProfileEmailArchiveService", () => {
  it("does not archive unsent draft bodies or attachments as delivered history", async () => {
    const saved: any[] = [];
    let copied: string[] = [];
    const messages = ["sent", "draft"].map((id) => ({
      id,
      labelIds: [id === "draft" ? "DRAFT" : "SENT"],
      internalDateMs: 1,
      from: "zone@example.com",
      to: "customer@example.com",
      cc: "",
      subject: "Fair",
      date: "today",
      direction: "outgoing" as const,
      bodyText: id === "draft" ? "Unsent private edit" : "Sent text",
      attachments:
        id === "draft"
          ? [
              {
                messageId: id,
                attachmentId: "private",
                filename: "draft.pdf",
                mimeType: "application/pdf",
                sizeBytes: 3,
              },
            ]
          : [],
    }));
    const service = new GoogleProfileEmailArchiveService({
      connection: {
        createReadClient: async () =>
          client({
            getThreadDetail: async () => ({
              id: "thread-1",
              subject: "Fair",
              originalGmailUrl: "url",
              messages,
            }),
          }),
      },
      validation: { organizationOwnsApprovedThread: async () => true },
      archive: {
        findByProviderThread: async () => null,
        upsertThread: async (input: any) => {
          saved.push(...input.messages);
          return archived({
            messages: input.messages,
            archiveState: input.archiveState,
          });
        },
        recordSyncFailure: vi.fn(),
      } as never,
      files: {
        copyApprovedThreadAttachments: async (input) => {
          copied = input.detail!.messages.map((m) => m.id);
          return [];
        },
      },
    });
    const result = await service.archiveApprovedThread({
      organizationId: "org-1",
      contactId: null,
      gmailThreadId: "thread-1",
    });
    expect(result.archiveState).toBe("complete");
    expect(saved.map((m) => m.gmailMessageId)).not.toContain("draft");
    expect(saved.map((m) => m.gmailMessageId)).toContain("sent");
    expect(copied).toEqual([]);
    expect(messages[1].bodyText).toBe("Unsent private edit");
  });
  it("archives message bodies before copying attachments and finishes complete", async () => {
    const calls: string[] = [];
    const upsertThread = vi.fn(async (input) => {
      calls.push(`save:${input.archiveState}`);
      return archived({
        archiveState: input.archiveState,
        messages: input.messages.map((message, index) => ({
          id: `saved-${index}`,
          ...message,
        })),
      });
    });
    const service = new GoogleProfileEmailArchiveService({
      connection: {
        createReadClient: async () => client({
          getThreadDetail: async () => ({
            id: "thread-1",
            subject: "Spring fair",
            originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
            messages: [{
              id: "message-1",
              internalDateMs: 123,
              from: "customer@example.com",
              to: "zone@example.com",
              cc: "",
              subject: "Spring fair",
              date: "Tue, 9 Sep 2026 12:00:00 +0000",
              direction: "incoming",
              bodyText: "Can we book?",
              attachments: [{
                attachmentId: "attachment-1",
                filename: "details.pdf",
                mimeType: "application/pdf",
                sizeBytes: 3,
                messageId: "message-1",
              }],
            }],
          }),
        }),
      },
      validation: { organizationOwnsApprovedThread: async () => true },
      archive: {
        upsertThread,
        findByProviderThread: async () => null,
        recordSyncFailure: vi.fn(),
      } as never,
      files: {
        copyApprovedThreadAttachments: async () => {
          calls.push("copy-files");
          return [{
            id: "file-1",
            organizationId: "org-1",
            threadId: "thread-1",
            messageId: "message-1",
            attachmentId: "attachment-1",
            filename: "details.pdf",
            mimeType: "application/pdf",
            sizeBytes: 3,
            contentSha256: "sha",
            storageObjectKey: "object",
            availability: "available",
            lastErrorCode: null,
            createdAt: "2026-09-09T12:00:00.000Z",
          }];
        },
      },
      now: () => new Date("2026-09-09T12:00:00.000Z"),
    });

    const result = await service.archiveApprovedThread({
      organizationId: "org-1",
      contactId: "contact-1",
      gmailThreadId: "thread-1",
    });

    expect(calls).toEqual(["save:pending", "copy-files", "save:complete"]);
    expect(upsertThread).toHaveBeenNthCalledWith(1, expect.objectContaining({
      organizationId: "org-1",
      gmailThreadId: "thread-1",
      archiveState: "pending",
      messages: [expect.objectContaining({
        gmailMessageId: "message-1",
        bodyText: "Can we book?",
      })],
    }));
    expect(result.archiveState).toBe("complete");
  });

  it("keeps saved message content and reports partial when an attachment needs retry", async () => {
    const upsertThread = vi.fn(async (input) => archived({
      archiveState: input.archiveState,
      messages: input.messages.map((message, index) => ({ id: `saved-${index}`, ...message })),
    }));
    const service = new GoogleProfileEmailArchiveService({
      connection: {
        createReadClient: async () => client({
          getThreadDetail: async () => ({
            id: "thread-1",
            subject: "Files",
            originalGmailUrl: "",
            messages: [{
              id: "message-1",
              internalDateMs: 1,
              from: "a@example.com",
              to: "b@example.com",
              cc: "",
              subject: "Files",
              date: "",
              direction: "incoming",
              bodyText: "Saved even when file fails",
              attachments: [{
                attachmentId: "attachment-1",
                filename: "bad.pdf",
                mimeType: "application/pdf",
                sizeBytes: 20,
                messageId: "message-1",
              }],
            }],
          }),
        }),
      },
      validation: { organizationOwnsApprovedThread: async () => true },
      archive: {
        upsertThread,
        findByProviderThread: async () => null,
        recordSyncFailure: vi.fn(),
      } as never,
      files: {
        copyApprovedThreadAttachments: async () => [{
          id: "file-1",
          organizationId: "org-1",
          threadId: "thread-1",
          messageId: "message-1",
          attachmentId: "attachment-1",
          filename: "bad.pdf",
          mimeType: "application/pdf",
          sizeBytes: 20,
          contentSha256: null,
          storageObjectKey: null,
          availability: "retry_required",
          lastErrorCode: "GOOGLE_WORKSPACE_PROFILE_FILE_COPY_FAILED",
          createdAt: "2026-09-09T12:00:00.000Z",
        }],
      },
    });

    const result = await service.archiveApprovedThread({
      organizationId: "org-1",
      contactId: null,
      gmailThreadId: "thread-1",
    });

    expect(result.archiveState).toBe("partial");
    expect(upsertThread).toHaveBeenLastCalledWith(expect.objectContaining({
      archiveState: "partial",
      messages: [expect.objectContaining({ bodyText: "Saved even when file fails" })],
    }));
  });

  it("returns the durable copy when Gmail is deleted and records the refresh failure", async () => {
    const saved = archived({ messages: [{
      id: "saved-message",
      gmailMessageId: "message-1",
      gmailThreadId: "thread-1",
      internalDateMs: 1,
      from: "a@example.com",
      to: "b@example.com",
      cc: "",
      subject: "Still here",
      date: "",
      direction: "incoming",
      bodyText: "Permanent copy",
      attachments: [],
    }] });
    const recordSyncFailure = vi.fn(async () => undefined);
    const service = new GoogleProfileEmailArchiveService({
      connection: {
        createReadClient: async () => client({
          getThreadDetail: async () => {
            throw new Error("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
          },
        }),
      },
      validation: { organizationOwnsApprovedThread: async () => true },
      archive: {
        upsertThread: vi.fn(),
        findByProviderThread: async () => saved,
        recordSyncFailure,
      } as never,
      files: { copyApprovedThreadAttachments: vi.fn() },
      now: () => new Date("2026-09-09T13:00:00.000Z"),
    });

    await expect(service.archiveApprovedThread({
      organizationId: "org-1",
      contactId: "contact-1",
      gmailThreadId: "thread-1",
    })).resolves.toMatchObject({
      id: saved.id,
      messages: saved.messages,
      lastGmailErrorCode: "GOOGLE_WORKSPACE_API_REQUEST_FAILED",
    });
    expect(recordSyncFailure).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      code: "GOOGLE_WORKSPACE_API_REQUEST_FAILED",
      now: new Date("2026-09-09T13:00:00.000Z"),
    });
  });
});
