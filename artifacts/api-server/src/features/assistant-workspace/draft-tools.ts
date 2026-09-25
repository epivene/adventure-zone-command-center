import { parse } from "parse5";
import { createHash } from "node:crypto";
import { sanitizeCustomEmailHtml } from "../communication-templates/email-template-compiler";
export type DraftContent = {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  threadId: string | null;
  attachmentHashes: string[];
  text?: string;
  batchId?: string | null;
  contactId?: string | null;
  eventYear?: number | null;
  bookingId?: string | null;
  organizationId?: string | null;
  templateId?: string | null;
  templateVersion?: string | null;
  attachmentIds?: string[];
};
export function draftFingerprint(content: DraftContent) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        to: content.to,
        cc: content.cc,
        subject: content.subject,
        html: content.html,
        threadId: content.threadId,
        attachmentHashes: content.attachmentHashes,
        text: content.text,
        batchId: content.batchId,
        contactId: content.contactId,
        eventYear: content.eventYear,
        bookingId: content.bookingId,
        organizationId: content.organizationId,
        templateId: content.templateId,
        templateVersion: content.templateVersion,
        attachmentIds: content.attachmentIds,
      }),
    )
    .digest("hex");
}
export function assertDraftUnchanged(input: {
  expectedRevision: string;
  currentRevision: string;
  savedGmailHash: string | null;
  currentGmailHash: string | null;
}) {
  if (input.expectedRevision !== input.currentRevision)
    throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
  if (input.savedGmailHash !== input.currentGmailHash)
    throw new Error("ASSISTANT_GMAIL_DRAFT_CHANGED");
}
function header(s: string) {
  if (!s || /[\r\n\0]/.test(s))
    throw new Error("ASSISTANT_EMAIL_HEADER_INVALID");
  return s;
}
function addresses(values: string[]) {
  return values
    .map((v) => {
      header(v);
      if (
        !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(
          v,
        )
      )
        throw new Error("ASSISTANT_RECIPIENT_INVALID");
      return v;
    })
    .join(", ");
}
const base64 = (v: string | Uint8Array) =>
  Buffer.from(v)
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
export function buildDraftMime(
  input: DraftContent & {
    messageId: string;
    inReplyTo: string | null;
    references: string[];
    text: string;
    attachments: { filename: string; mimeType: string; bytes: Uint8Array }[];
  },
): string {
  if (!input.to.length || !input.html || !input.text)
    throw new Error("ASSISTANT_DRAFT_CONTENT_REQUIRED");
  if (input.threadId && !input.inReplyTo)
    throw new Error("ASSISTANT_REPLY_SOURCE_REQUIRED");
  const msg = (s: string) => {
    header(s);
    if (!/^<[^<>\s]+@[^<>\s]+>$/.test(s))
      throw new Error("ASSISTANT_MESSAGE_ID_INVALID");
    return s;
  };
  if (
    input.attachments.reduce((sum, a) => sum + a.bytes.length, 0) >
    20 * 1024 * 1024
  )
    throw new Error("ASSISTANT_ATTACHMENT_LIMIT");
  const boundary =
    "az_" +
    createHash("sha256")
      .update(input.messageId + draftFingerprint(input))
      .digest("hex")
      .slice(0, 32);
  const alternative = boundary + "_alt";
  const subject = header(input.subject);
  const lines = [
    "MIME-Version: 1.0",
    `To: ${addresses(input.to)}`,
    ...(input.cc.length ? [`Cc: ${addresses(input.cc)}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    `Message-ID: ${msg(input.messageId)}`,
    ...(input.inReplyTo
      ? [
          `In-Reply-To: ${msg(input.inReplyTo)}`,
          `References: ${[...new Set([...input.references, input.inReplyTo])].map(msg).join(" ")}`,
        ]
      : []),
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    `--${alternative}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(input.text),
    `--${alternative}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(sanitizeCustomEmailHtml(input.html)),
    `--${alternative}--`,
  ];
  for (const a of input.attachments) {
    header(a.filename);
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType))
      throw new Error("ASSISTANT_ATTACHMENT_MIME_INVALID");
    const filename = encodeURIComponent(a.filename).replaceAll("'", "%27");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}`,
      `Content-Disposition: attachment; filename*=UTF-8''${filename}`,
      "Content-Transfer-Encoding: base64",
      "",
      base64(a.bytes),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}
export function assertApprovedDraftLinks(template: string, draft: string) {
  const links = (html: string) => {
    const values: string[] = [];
    const visit = (node: any) => {
      for (const attr of node.attrs ?? [])
        if (["href", "src"].includes(attr.name)) values.push(attr.value);
      for (const child of node.childNodes ?? []) visit(child);
    };
    visit(parse(html));
    return values;
  };
  const approved = new Set(links(template));
  if (
    links(draft).some(
      (link) =>
        !approved.has(link) || !/^(https:\/\/|mailto:|tel:)/i.test(link),
    )
  )
    throw new Error("ASSISTANT_UNAPPROVED_TEMPLATE_LINK");
}
