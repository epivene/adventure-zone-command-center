import { expect, it, vi } from "vitest";
import { GoogleProfileEmailArchiveService } from "./google-profile-email-archive-service";
import { GoogleProfileFileService } from "./google-profile-file-service";

it("archives one consistent snapshot when Gmail attachment handles change on each read", async () => {
  let reads = 0;
  const files: any[] = [];
  const getThreadDetail = vi.fn(async () => ({
    id: "thread", subject: "Proposal", originalGmailUrl: "",
    messages: [{ id: "message", internalDateMs: 1, from: "fair@example.com",
      to: "zone@example.com", cc: "", subject: "Proposal", date: "",
      direction: "incoming" as const, bodyText: "Please review",
      attachments: [{ messageId: "message", attachmentId: `handle-${++reads}`,
        filename: "proposal.pdf", mimeType: "application/pdf", sizeBytes: 3 }] }],
  }));
  const getAttachment = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const connection = { createReadClient: async () => ({ getThreadDetail, getAttachment }) as any };
  const validation = { organizationOwnsApprovedThread: async () => true };
  const fileService = new GoogleProfileFileService({ connection, validation,
    repository: {
      saveFile: async (f: any) => { const saved = { ...f, id: "file", availability: "available" }; files.push(saved); return saved; },
      markUnavailable: vi.fn(), listForOrganization: async () => files,
    } as any,
    storage: { exists: async () => false, put: vi.fn() } as any,
  });
  const saved: any[] = [];
  const service = new GoogleProfileEmailArchiveService({ connection, validation, files: fileService,
    archive: { findByProviderThread: async () => null, recordSyncFailure: vi.fn(),
      upsertThread: async (value: any) => { saved.push(value); return { ...value, id: "archive" }; },
    } as any,
  });
  const result = await service.archiveApprovedThread({ organizationId: "profile", contactId: null, gmailThreadId: "thread" });
  expect(result.archiveState).toBe("complete");
  expect(getThreadDetail).toHaveBeenCalledTimes(1);
  expect(getAttachment).toHaveBeenCalledWith({ messageId: "message", attachmentId: "handle-1" });
  expect(saved[0].messages[0].bodyText).toBe("Please review");
  expect(files).toHaveLength(1);
});
