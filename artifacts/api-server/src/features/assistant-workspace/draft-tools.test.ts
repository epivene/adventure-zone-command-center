import { it, expect } from "vitest";
import {
  draftFingerprint,
  buildDraftMime,
  assertDraftUnchanged,
} from "./draft-tools";
const content = {
  to: ["contact@example.test"],
  cc: [],
  subject: "Reply",
  html: "<p>Hello</p>",
  threadId: "t1",
  attachmentHashes: ["old"],
};
it("invalidates approval when any send-affecting field changes", () => {
  for (const change of [
    { attachmentHashes: ["new"] },
    { to: ["other@example.test"] },
    { cc: ["cc@example.test"] },
    { subject: "New" },
    { html: "<p>New</p>" },
    { threadId: "t2" },
  ])
    expect(draftFingerprint(content)).not.toBe(
      draftFingerprint({ ...content, ...change }),
    );
});
it("builds threaded multipart email with attachment bytes", () => {
  const raw = buildDraftMime({
    ...content,
    attachmentHashes: [],
    messageId: "<stable@assistant.invalid>",
    inReplyTo: "<prior@example.test>",
    references: ["<prior@example.test>"],
    text: "Hello",
    attachments: [
      {
        filename: "terms.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      },
    ],
  });
  const mime = Buffer.from(raw, "base64url").toString();
  expect(mime).toContain("multipart/mixed");
  expect(mime).toContain("multipart/alternative");
  expect(mime).toContain("In-Reply-To: <prior@example.test>");
  expect(mime).toContain("AQID");
  expect(mime).toContain("Message-ID: <stable@assistant.invalid>");
});
it("blocks header injection and missing reply metadata", () => {
  expect(() =>
    buildDraftMime({
      ...content,
      subject: "Hello\r\nBcc: victim@example.test",
      messageId: "<a@example.test>",
      inReplyTo: "<p@example.test>",
      references: [],
      text: "Hi",
      attachments: [],
    }),
  ).toThrow();
  expect(() =>
    buildDraftMime({
      ...content,
      messageId: "<a@example.test>",
      inReplyTo: null,
      references: [],
      text: "Hi",
      attachments: [],
    }),
  ).toThrow("ASSISTANT_REPLY_SOURCE_REQUIRED");
});
it("rejects manual Gmail edits and stale app revisions", () => {
  expect(() =>
    assertDraftUnchanged({
      expectedRevision: "v1",
      currentRevision: "v2",
      savedGmailHash: "g",
      currentGmailHash: "g",
    }),
  ).toThrow("ASSISTANT_DRAFT_VERSION_CONFLICT");
  expect(() =>
    assertDraftUnchanged({
      expectedRevision: "v1",
      currentRevision: "v1",
      savedGmailHash: "g",
      currentGmailHash: "manual",
    }),
  ).toThrow("ASSISTANT_GMAIL_DRAFT_CHANGED");
});
it("rejects invented links while retaining approved template links", async () => {
  const { assertApprovedDraftLinks } = await import("./draft-tools");
  expect(() =>
    assertApprovedDraftLinks(
      '<a href="https://example.test/package">Package</a>',
      '<a href="https://wrong.test/old">Package</a>',
    ),
  ).toThrow("ASSISTANT_UNAPPROVED_TEMPLATE_LINK");
  expect(() =>
    assertApprovedDraftLinks(
      '<a href="https://example.test/package">Package</a>',
      '<a href="https://example.test/package">See package</a>',
    ),
  ).not.toThrow();
});

it("binds booking, event year and template to the draft revision", () => {
  const content: any = {
    to: ["a@example.test"],
    cc: [],
    subject: "Reply",
    html: "<p>40%</p>",
    threadId: null,
    attachmentHashes: [],
    eventYear: 2027,
    bookingId: null,
    templateId: "template",
    templateVersion: "v1",
  };
  const original = draftFingerprint(content);
  expect(draftFingerprint({ ...content, eventYear: 2028 })).not.toBe(original);
  expect(draftFingerprint({ ...content, bookingId: "other" })).not.toBe(
    original,
  );
  expect(draftFingerprint({ ...content, templateVersion: "v2" })).not.toBe(
    original,
  );
});
it("binds a campaign member contact and batch to the reviewed draft revision", () => {
  const d = {
    ...content,
    attachmentHashes: [],
    batchId: "batch",
    contactId: "first-contact",
  };
  expect(draftFingerprint({ ...d, contactId: "replacement-contact" })).not.toBe(
    draftFingerprint(d),
  );
  expect(draftFingerprint({ ...d, batchId: "other-batch" })).not.toBe(
    draftFingerprint(d),
  );
});
