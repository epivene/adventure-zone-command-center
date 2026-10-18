import { expect, it, vi } from "vitest";
import { boundedArchiveClient } from "./google-mailbox-sync-archive-client";
it("rotates attachment attempts so an unavailable first attachment cannot starve another", async () => {
  const download = vi.fn(async ({ attachmentId }: { attachmentId: string }) => {
    if (attachmentId === "bad") throw Error("missing");
    return new Uint8Array([1]);
  });
  const client = {
    getSyncThreadDetail: async () => ({
      id: "t",
      messages: [
        {
          id: "m",
          labelIds: ["SENT"],
          attachments: [{ attachmentId: "bad" }, { attachmentId: "good" }],
        },
        {
          id: "d",
          labelIds: ["DRAFT"],
          attachments: [{ attachmentId: "draft" }],
        },
      ],
    }),
    getSyncAttachment: download,
  } as any;
  for (let attempt = 0; attempt < 2; attempt++) {
    const bounded = boundedArchiveClient(client, attempt);
    const detail = await bounded.getThreadDetail!("t");
    expect(detail.messages).toHaveLength(1);
    for (const attachment of detail.messages[0].attachments)
      await bounded.getAttachment!({
        messageId: "m",
        attachmentId: attachment.attachmentId,
      }).catch(() => {});
  }
  expect(download.mock.calls.map((c) => c[0].attachmentId)).toEqual([
    "bad",
    "good",
  ]);
});
it("keeps distinct immutable MIME part identities when provider handles rotate", async () => {
  let revision = 0;
  const downloads: string[] = [];
  const client = {
    getSyncThreadDetail: async () => ({
      id: "t",
      messages: [
        {
          id: "m",
          labelIds: [],
          attachments: [0, 1].map((i) => ({
            attachmentId: `handle-${revision}-${i}`,
            filename: "same.pdf",
            sizeBytes: 3,
            mimeType: "application/pdf",
          })),
        },
      ],
    }),
    getSyncAttachment: async ({ attachmentId }: { attachmentId: string }) => {
      downloads.push(attachmentId);
      return new Uint8Array([1]);
    },
  } as any;
  const first = boundedArchiveClient(client, 0);
  const before = await first.getThreadDetail!("t");
  revision++;
  const second = boundedArchiveClient(client, 1);
  const after = await second.getThreadDetail!("t");
  expect(after.messages[0].attachments.map((a) => a.attachmentId)).toEqual(
    before.messages[0].attachments.map((a) => a.attachmentId),
  );
  expect(
    new Set(after.messages[0].attachments.map((a) => a.attachmentId)).size,
  ).toBe(2);
  await second.getAttachment!({
    messageId: "m",
    attachmentId: after.messages[0].attachments[1].attachmentId,
  });
  expect(downloads).toEqual(["handle-1-1"]);
});
