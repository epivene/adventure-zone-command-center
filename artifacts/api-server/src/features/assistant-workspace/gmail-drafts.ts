import { createHash } from "node:crypto";
import type { ActionIntent, RunContext, ToolResult } from "./contracts";
import type { MutationAdapter } from "./action-executor";
import type { DraftStore, WorkspaceDraft } from "./draft-store";
import type { PostgresGoogleConnectionRepository } from "../google-workspace/google-connection-repository";
import type { GoogleWorkspaceReadClient } from "../google-workspace/google-api-types";
import { BusinessDocumentRepository } from "../business-documents/business-document-repository";
import { BusinessDocumentStorage } from "../business-documents/business-document-storage";
import { buildDraftMime, assertDraftUnchanged } from "./draft-tools";
const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
function decoded(raw: string) {
  return Buffer.from(raw, "base64url")
    .toString("utf8")
    .replace(/\r?\n/g, "\r\n");
}
function header(raw: string, name: string) {
  const head = decoded(raw)
    .split("\r\n\r\n")[0]
    .replace(/\r\n[ \t]+/g, " ");
  return (
    head
      .split("\r\n")
      .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
      ?.slice(name.length + 1)
      .trim() ?? null
  );
}
export function assertMimeReadback(expected: string, actual: string) {
  for (const name of [
    "To",
    "Cc",
    "Subject",
    "Message-ID",
    "In-Reply-To",
    "References",
    "Content-Type",
  ]) {
    if (header(expected, name) !== header(actual, name))
      throw new Error("ASSISTANT_GMAIL_READBACK_MISMATCH");
  }
  if (
    decoded(expected).split("\r\n\r\n").slice(1).join("\r\n\r\n").trim() !==
    decoded(actual).split("\r\n\r\n").slice(1).join("\r\n\r\n").trim()
  )
    throw new Error("ASSISTANT_GMAIL_READBACK_MISMATCH");
}
export function gmailDraftAdapter(
  drafts: DraftStore,
  google: PostgresGoogleConnectionRepository,
): MutationAdapter {
  const files = new BusinessDocumentRepository(),
    storage = new BusinessDocumentStorage();
  async function access(context: RunContext, intent: ActionIntent) {
    const draft = await drafts.get(context.actor.id, intent.targetId);
    if (
      !draft ||
      draft.conversationId !== context.conversationId ||
      !draft.content.organizationId ||
      !context.selection.organizationIds.includes(draft.content.organizationId)
    )
      throw new Error("ASSISTANT_DRAFT_NOT_FOUND");
    if (draft.revision !== intent.expectedRevision)
      throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
    const current = await google.getCurrent();
    if (
      !current ||
      current.id !== intent.connectionId ||
      current.id !== context.actor.connectionId
    )
      throw new Error("ASSISTANT_CONNECTION_CHANGED");
    const client = await google.createReadClient();
    if (!client?.getGmailDraftRaw)
      throw new Error("ASSISTANT_GMAIL_READBACK_UNAVAILABLE");
    return { draft, client };
  }
  async function mime(
    draft: WorkspaceDraft,
    client: GoogleWorkspaceReadClient,
  ) {
    let inReplyTo: string | null = null,
      references: string[] = [];
    if (draft.content.threadId) {
      if (!client.getThreadDetail || !client.getGmailMessageRaw)
        throw new Error("ASSISTANT_REPLY_SOURCE_REQUIRED");
      const thread = await client.getThreadDetail(draft.content.threadId);
      const last = thread.messages.at(-1);
      if (!last) throw new Error("ASSISTANT_REPLY_SOURCE_REQUIRED");
      const raw = await client.getGmailMessageRaw(last.id);
      if (raw.threadId !== draft.content.threadId)
        throw new Error("ASSISTANT_REPLY_SOURCE_REQUIRED");
      inReplyTo = header(raw.raw, "Message-ID");
      references =
        (header(raw.raw, "References") ?? "").match(/<[^<>\s]+@[^<>\s]+>/g) ??
        [];
    }
    const attachments = [];
    for (let i = 0; i < draft.content.attachmentIds.length; i++) {
      const id = draft.content.attachmentIds[i];
      const metadata = await files.getById(id);
      if (
        !metadata ||
        metadata.lifecycle === "deleted" ||
        !metadata.links.some(
          (l) =>
            l.targetKind === "profile" &&
            l.targetId === draft.content.organizationId,
        )
      )
        throw new Error("ASSISTANT_ATTACHMENT_PROFILE_MISMATCH");
      const file = await files.getOpenableFile(id);
      if (!file) throw new Error("ASSISTANT_ATTACHMENT_UNAVAILABLE");
      const bytes = await storage.get(file.storageKey);
      if (hash(bytes) !== draft.content.attachmentHashes[i])
        throw new Error("ASSISTANT_ATTACHMENT_CHANGED");
      if (Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-")
        throw new Error("ASSISTANT_ATTACHMENT_FORMAT_UNSUPPORTED");
      attachments.push({
        filename: metadata.originalFilename,
        mimeType: "application/pdf",
        bytes,
      });
    }
    return buildDraftMime({
      ...draft.content,
      messageId: draft.messageId,
      inReplyTo,
      references,
      attachments,
    });
  }
  function receipt(draft: WorkspaceDraft): ToolResult {
    return {
      status: "ok",
      data: {
        draftId: draft.id,
        gmailDraftId: draft.gmailDraftId,
        revision: draft.revision,
      },
      evidence: [],
      receipts: [
        {
          kind: "gmail_draft",
          id: draft.id,
          href: `/assistant/workspace/${draft.conversationId}`,
          verifiedAt: new Date().toISOString(),
        },
      ],
      code: null,
    };
  }
  return {
    async validate(context, intent) {
      const { draft, client } = await access(context, intent);
      if (draft.gmailDraftId) {
        const current = await client.getGmailDraftRaw!(draft.gmailDraftId);
        assertDraftUnchanged({
          expectedRevision: intent.expectedRevision!,
          currentRevision: draft.revision,
          savedGmailHash: draft.gmailHash,
          currentGmailHash: hash(current.raw),
        });
      }
      await mime(draft, client);
    },
    async apply(context, intent) {
      const { draft, client } = await access(context, intent);
      const raw = await mime(draft, client);
      const writer = await google.createGmailDraftClient();
      if (!writer || writer.connectionId !== intent.connectionId)
        throw new Error("ASSISTANT_CONNECTION_CHANGED");
      await drafts.claimSave(
        context.actor.id,
        draft.id,
        draft.revision,
        writer.connectionId,
      );
      try {
        const saved = draft.gmailDraftId
          ? await writer.client.updateGmailDraft!({
              draftId: draft.gmailDraftId,
              raw,
              threadId: draft.content.threadId,
            })
          : await writer.client.createGmailDraft({
              raw,
              threadId: draft.content.threadId,
            });
        const readback = await client.getGmailDraftRaw!(saved.draftId);
        assertMimeReadback(raw, readback.raw);
        if (
          draft.content.threadId &&
          readback.threadId !== draft.content.threadId
        )
          throw new Error("ASSISTANT_GMAIL_THREAD_CHANGED");
        return receipt(
          await drafts.saved(
            context.actor.id,
            draft.id,
            draft.revision,
            saved.draftId,
            hash(readback.raw),
          ),
        );
      } catch (error) {
        await drafts.mark(
          context.actor.id,
          draft.id,
          draft.revision,
          "uncertain",
        );
        throw error;
      }
    },
    async reconcile(context, intent) {
      const { draft, client } = await access(context, intent);
      if (!client.listGmailDrafts)
        return {
          status: "uncertain",
          data: null,
          evidence: [],
          receipts: [],
          code: "ASSISTANT_GMAIL_RECONCILIATION_REQUIRED",
        };
      const page = await client.listGmailDrafts(
        `rfc822msgid:${draft.messageId.replace(/[<>]/g, "")}`,
      );
      if (page.nextPageToken || page.drafts.length !== 1)
        return {
          status: "uncertain",
          data: null,
          evidence: [],
          receipts: [],
          code: "ASSISTANT_GMAIL_RECONCILIATION_REQUIRED",
        };
      const found = await client.getGmailDraftRaw!(page.drafts[0].id);
      assertMimeReadback(await mime(draft, client), found.raw);
      return receipt(
        await drafts.saved(
          context.actor.id,
          draft.id,
          draft.revision,
          found.draftId,
          hash(found.raw),
        ),
      );
    },
  };
}
