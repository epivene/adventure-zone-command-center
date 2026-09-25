import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "./contracts";
import { draftFingerprint } from "./draft-tools";
import { sanitizeCustomEmailHtml } from "../communication-templates/email-template-compiler";
export const draftContentSchema = z
  .object({
    to: z.array(z.email()).min(1).max(20),
    cc: z.array(z.email()).max(20),
    subject: z
      .string()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]*$/),
    html: z.string().min(1).max(150000),
    text: z.string().min(1).max(30000),
    threadId: z.string().max(256).nullable(),
    attachmentHashes: z.array(z.string()).max(15),
    attachmentIds: z.array(z.string().uuid()).max(15),
    organizationId: z.string().uuid().nullable(),
    templateId: z.string().uuid().nullable(),
    templateVersion: z.string().nullable(),
    batchId: z.string().uuid().nullable().optional(),
    contactId: z.string().uuid().nullable().optional(),
    eventYear: z.number().int().min(2000).max(2200).nullable().optional(),
    bookingId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type StoredDraftContent = z.infer<typeof draftContentSchema>;
export type WorkspaceDraft = {
  id: string;
  actorId: string;
  conversationId: string;
  content: StoredDraftContent;
  revision: string;
  status: string;
  gmailDraftId: string | null;
  gmailHash: string | null;
  connectionId: string | null;
  messageId: string;
};
const map = (r: any): WorkspaceDraft => ({
  id: r.id,
  actorId: r.actor_id,
  conversationId: r.conversation_id,
  content: r.content,
  revision: r.revision,
  status: r.status,
  gmailDraftId: r.gmail_draft_id,
  gmailHash: r.gmail_hash,
  connectionId: r.connection_id,
  messageId: r.message_id,
});
function clean(raw: StoredDraftContent) {
  const c = draftContentSchema.parse(raw);
  c.html = sanitizeCustomEmailHtml(c.html);
  if (c.attachmentIds.length !== c.attachmentHashes.length)
    throw new Error("ASSISTANT_ATTACHMENTS_INVALID");
  return c;
}
export class DraftStore {
  constructor(private readonly db: Queryable) {}
  async create(
    actorId: string,
    conversationId: string,
    raw: StoredDraftContent,
    id: string = randomUUID(),
  ): Promise<WorkspaceDraft> {
    const content = clean(raw);
    const r = await this.db.query(
      `INSERT INTO assistant_workspace_drafts(id,actor_id,conversation_id,content,revision,message_id) SELECT $1,actor_id,id,$4::jsonb,$5,$6 FROM assistant_workspace_conversations WHERE actor_id=$2 AND id=$3 ON CONFLICT(id) DO NOTHING RETURNING *`,
      [
        id,
        actorId,
        conversationId,
        JSON.stringify(content),
        draftFingerprint(content),
        `<${id}@assistant.adventure-zone.invalid>`,
      ],
    );
    if (r.rows[0]) return map(r.rows[0]);
    const existing = await this.get(actorId, id);
    if (
      !existing ||
      existing.conversationId !== conversationId ||
      existing.revision !== draftFingerprint(content)
    )
      throw new Error("ASSISTANT_DRAFT_CONFLICT");
    return existing;
  }
  async get(actorId: string, id: string): Promise<WorkspaceDraft | null> {
    const r = await this.db.query(
      `SELECT * FROM assistant_workspace_drafts WHERE actor_id=$1 AND id=$2`,
      [actorId, id],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }
  async list(actorId: string, conversationId: string) {
    return (
      await this.db.query(
        `SELECT * FROM assistant_workspace_drafts WHERE actor_id=$1 AND conversation_id=$2 ORDER BY updated_at DESC`,
        [actorId, conversationId],
      )
    ).rows.map(map);
  }
  async edit(
    actorId: string,
    id: string,
    expectedRevision: string,
    patch: Partial<StoredDraftContent>,
  ): Promise<WorkspaceDraft> {
    const prior = await this.get(actorId, id);
    if (!prior) throw new Error("ASSISTANT_DRAFT_NOT_FOUND");
    const content = clean({ ...prior.content, ...patch });
    if (
      prior.content.batchId &&
      [
        "batchId",
        "contactId",
        "organizationId",
        "bookingId",
        "eventYear",
        "to",
        "cc",
      ].some(
        (key) =>
          JSON.stringify((content as any)[key]) !==
          JSON.stringify((prior.content as any)[key]),
      )
    )
      throw new Error("ASSISTANT_BATCH_DRAFT_SCOPE_IMMUTABLE");
    const r = await this.db.query(
      `UPDATE assistant_workspace_drafts SET content=$4::jsonb,revision=$5,status='local',updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3 AND status IN ('local','saved') RETURNING *`,
      [
        actorId,
        id,
        expectedRevision,
        JSON.stringify(content),
        draftFingerprint(content),
      ],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
    return map(r.rows[0]);
  }
  async claimSave(
    actorId: string,
    id: string,
    revision: string,
    connectionId: string,
  ) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_drafts SET status='saving',connection_id=$4,updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3 AND status IN ('local','saved') AND (connection_id IS NULL OR connection_id=$4) RETURNING *`,
      [actorId, id, revision, connectionId],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
    return map(r.rows[0]);
  }
  async saved(
    actorId: string,
    id: string,
    revision: string,
    gmailDraftId: string,
    gmailHash: string,
  ) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_drafts SET status='saved',gmail_draft_id=$4,gmail_hash=$5,updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3 AND status IN ('saving','uncertain') RETURNING *`,
      [actorId, id, revision, gmailDraftId, gmailHash],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
    return map(r.rows[0]);
  }
  async claimSend(actorId: string, id: string, revision: string) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_drafts SET status='sending',updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3 AND status='saved' RETURNING *`,
      [actorId, id, revision],
    );
    if (!r.rows[0]) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
    return map(r.rows[0]);
  }
  async restoreUnsent(actorId: string, id: string, revision: string) {
    const r = await this.db.query(
      `UPDATE assistant_workspace_drafts SET status='saved',updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3 AND status='sending' RETURNING id`,
      [actorId, id, revision],
    );
    if (!r.rows.length) throw new Error("ASSISTANT_DRAFT_VERSION_CONFLICT");
  }
  async mark(
    actorId: string,
    id: string,
    revision: string,
    status: "uncertain" | "sent",
  ) {
    await this.db.query(
      `UPDATE assistant_workspace_drafts SET status=$4,updated_at=now() WHERE actor_id=$1 AND id=$2 AND revision=$3`,
      [actorId, id, revision, status],
    );
  }
}
