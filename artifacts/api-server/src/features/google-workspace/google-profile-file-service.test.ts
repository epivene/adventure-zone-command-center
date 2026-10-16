import { describe, expect, it, vi } from "vitest";

import type { GoogleWorkspaceReadClient } from "./google-api-types";
import { GoogleProfileFileService } from "./google-profile-file-service";

function gmailClient(overrides: Partial<GoogleWorkspaceReadClient>): GoogleWorkspaceReadClient {
  return {
    authorizationUrl: () => "",
    exchangeCode: async () => ({ refreshToken: "", scopes: [] }),
    accountIdentity: async () => ({ subject: null, email: "zone@example.com" }),
    listLabels: async () => [],
    listCalendars: async () => [],
    ...overrides,
  };
}

describe("GoogleProfileFileService", () => {
  it('does not download an already archived attachment again',async()=>{
    const attachment={messageId:'m',attachmentId:'new-handle',filename:'contract.pdf',mimeType:'application/pdf',sizeBytes:3};
    const file={...attachment,attachmentId:'old-handle',id:'f',organizationId:'p',threadId:'t',contentSha256:'sha',storageObjectKey:'key',availability:'available',lastErrorCode:null,createdAt:''};
    let downloads=0;
    const service=new GoogleProfileFileService({connection:{createReadClient:async()=>gmailClient({getThreadDetail:async()=>({id:'t',messages:[{id:'m',attachments:[attachment]}]} as any),getAttachment:async()=>{downloads++;return new Uint8Array([1,2,3]);}})},validation:{organizationOwnsApprovedThread:async()=>true},repository:{listForOrganization:async()=>[file],saveFile:async()=>file,markUnavailable:async()=>{}} as any,storage:{exists:async()=>true} as any});
    expect(await service.copyApprovedThreadAttachments({organizationId:'p',threadId:'t'})).toHaveLength(1);
    expect(downloads).toBe(0);
  });
  it("copies approved thread attachments once, deduplicates storage by checksum, and lists profile files", async () => {
    const storage = {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => new Uint8Array()),
      exists: vi.fn(async () => false),
      getSignedReadUrl: vi.fn(async () => "https://signed.example/file"),
      delete: vi.fn(async () => undefined),
    };
    const saveFile = vi.fn(async (input) => ({
      id: "file-1",
      ...input,
      availability: "available" as const,
      lastErrorCode: null,
      createdAt: "2026-08-24T18:00:00.000Z",
    }));
    const repository = {
      saveFile,
      listForOrganization: vi.fn(async () => [{
        id: "file-1",
        organizationId: "org-1",
        threadId: "t1",
        messageId: "m1",
        attachmentId: "a1",
        filename: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        contentSha256: "sha",
        storageObjectKey: "google-workspace/attachments/sha",
        availability: "available" as const,
        lastErrorCode: null,
        createdAt: "2026-08-24T18:00:00.000Z",
      }]),
      getOwnedFile: vi.fn(async () => ({
        id: "file-1",
        organizationId: "org-1",
        storageObjectKey: "google-workspace/attachments/sha",
        availability: "available" as const,
      })),
      markUnavailable: vi.fn(async () => undefined),
    };
    const service = new GoogleProfileFileService({
      connection: {
        createReadClient: async () => gmailClient({
          getThreadDetail: async () => ({
            id: "t1",
            subject: "Contract",
            originalGmailUrl: "https://mail.google.com/mail/u/0/#all/t1",
            messages: [{
              id: "m1",
              internalDateMs: 1,
              from: "fair@example.org",
              to: "zone@example.com",
              cc: "",
              subject: "Contract",
              date: "",
              direction: "incoming",
              bodyText: "Attached",
              attachments: [{
                attachmentId: "a1",
                filename: "contract.pdf",
                mimeType: "application/pdf",
                sizeBytes: 3,
                messageId: "m1",
              }],
            }],
          }),
          getAttachment: async () => new Uint8Array([1, 2, 3]),
        }),
      },
      validation: {
        organizationOwnsApprovedThread: async () => true,
      },
      repository,
      storage,
    });

    const files = await service.copyApprovedThreadAttachments({ organizationId: "org-1", threadId: "t1" });

    expect(files).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      threadId: "t1",
      messageId: "m1",
      attachmentId: "a1",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
    }));
  });

  it("refuses cross-profile thread access before fetching file bytes", async () => {
    const createReadClient = vi.fn(async () => gmailClient({
      getThreadDetail: vi.fn(),
      getAttachment: vi.fn(),
    }));
    const service = new GoogleProfileFileService({
      connection: { createReadClient },
      validation: { organizationOwnsApprovedThread: async () => false },
      repository: {} as never,
      storage: {} as never,
    });

    await expect(service.copyApprovedThreadAttachments({ organizationId: "org-2", threadId: "t1" }))
      .rejects.toThrow("GOOGLE_WORKSPACE_PROFILE_THREAD_NOT_FOUND");
    expect(createReadClient).not.toHaveBeenCalled();
  });

  it("opens only an available file owned by the requested profile with a 15-minute signed URL", async () => {
    const getSignedReadUrl = vi.fn(async () => "https://signed.example/file");
    const service = new GoogleProfileFileService({
      connection: {} as never,
      validation: {} as never,
      repository: {
        getOwnedFile: async () => ({
          id: "file-1",
          organizationId: "org-1",
          storageObjectKey: "google-workspace/attachments/sha",
          availability: "available" as const,
        }),
      } as never,
      storage: { getSignedReadUrl } as never,
    });

    await expect(service.openProfileFile({ organizationId: "org-1", fileId: "file-1" }))
      .resolves.toBe("https://signed.example/file");
    expect(getSignedReadUrl).toHaveBeenCalledWith("google-workspace/attachments/sha", 900);
  });
});
