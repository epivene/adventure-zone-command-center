import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/test"; });
import { GoogleGmailDocumentSource } from "./google-gmail-document-source";

function setup(existing: any = { profileId: null, blob: null }) {
  const client = {
    listMessagePage: vi.fn(async () => ({ messages: [{ id: "message-1", threadId: "thread-1" }], nextPageToken: null })),
    getMessageMetadata: vi.fn(async () => ({ id: "message-1", threadId: "thread-1", hasAttachments: true })),
    getThreadDetail: vi.fn(async () => ({ id: "thread-1", subject: "City COI", originalGmailUrl: "https://mail.google/thread-1", messages: [{ id: "message-1", subject: "City COI", bodyText: "", attachments: [{ attachmentId: "attachment-1", filename: "coi.pdf", mimeType: "application/pdf", sizeBytes: 10 }] }] })),
    getAttachment: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
  return { client, source: new GoogleGmailDocumentSource(client as any, { find: vi.fn(async () => existing) }) };
}

describe("GoogleGmailDocumentSource", () => {
  it("uses a bounded attachment query and stable message/attachment identity", async () => {
    const { client, source } = setup();
    const page = await source.inventoryPage({ after: "2025-01-01", before: "2026-01-01" });
    const candidate = await source.candidate(page.items[0]!, "workspace");
    expect(client.listMessagePage).toHaveBeenCalledWith(expect.objectContaining({ query: "after:2025/01/01 before:2026/01/01 has:attachment" }));
    expect(candidate.source).toMatchObject({ sourceKind: "gmail", externalId: "message-1:attachment-1" });
  });

  it("reuses a previously copied profile-file blob without downloading", async () => {
    const blob = { sha256Hex: "a".repeat(64), storageKey: "profile-files/a", sizeBytes: 10, mimeType: "application/pdf" };
    const { client, source } = setup({ profileId: "profile-1", blob });
    const page = await source.inventoryPage({ after: "2025-01-01", before: "2026-01-01" });
    const candidate = await source.candidate(page.items[0]!, "workspace");
    expect(candidate.storedBlob).toEqual(blob);
    expect(candidate.evidence.approvedThreadProfileId).toBe("profile-1");
    expect(client.getAttachment).not.toHaveBeenCalled();
  });
});
