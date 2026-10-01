import { randomUUID } from "node:crypto";
import { z } from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  ConnectionError,
  activeConnection,
  requireConnectionScope,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
  type SqlQuery,
  type Page,
} from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow, iso } from "./read-service";
import { receipt } from "./lead-note-service";
import {
  cleanDraftContent,
  type StoredDraftContent,
} from "../assistant-workspace/draft-content";
import { FollowUpService } from "../follow-ups/follow-up-service";
import { DrizzleFollowUpRepository } from "../follow-ups/follow-up-repository";
export type FollowupSummary = {
  id: string;
  profileId: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: string;
  completedAt: string | null;
  outcome: string | null;
  revision: string;
};
const followup = (r: any): FollowupSummary => ({
  id: r.id,
  profileId: r.organization_id,
  contactId: r.contact_id,
  bookingId: r.booking_id,
  kind: r.kind,
  dueAt: iso(r.due_at)!,
  completedAt: iso(r.completed_at),
  outcome: r.outcome ?? null,
  revision: r.revision,
});
export const closeFollowupSchema = z.object({
  profileId: z.string().uuid(),
  followupId: z.string().uuid(),
  expectedRevision: z.string().min(1).max(100),
  action: z.enum(["complete", "dismiss"]),
  reason: z.string().trim().min(1).max(2000),
}).strict();
async function associations(
  tx: SqlQuery,
  profileId: string,
  contactId?: string | null,
  bookingId?: string | null,
) {
  await profileRow(tx, profileId, true);
  if (
    contactId &&
    !(
      await tx.query(
        "SELECT contact_id FROM organization_contacts WHERE organization_id=$1 AND contact_id=$2 AND active=true",
        [profileId, contactId],
      )
    ).rows.length
  )
    throw new ConnectionError("CONNECTION_CONTACT_MISMATCH", 409);
  if (
    bookingId &&
    !(
      await tx.query(
        "SELECT id FROM bookings WHERE organization_id=$1 AND id=$2 FOR UPDATE",
        [profileId, bookingId],
      )
    ).rows.length
  )
    throw new ConnectionError("CONNECTION_BOOKING_MISMATCH", 409);
}
// The operation already owns a pinned transaction. Repository nested transactions
// reuse it rather than issuing an early COMMIT. Map rowMode for the SQL test adapter.
function followupService(tx: SqlQuery) {
  const client = {
    query: async (config: any, params: any[]) => {
      const result = await tx.query(
        typeof config === "string" ? config : config.text,
        params,
      );
      return {
        ...result,
        rows:
          config.rowMode === "array"
            ? result.rows.map((row) => Object.values(row))
            : result.rows,
      };
    },
  };
  const database = drizzle(client as any);
  const scoped = { transaction: async (work: any) => work(database) };
  return new FollowUpService(new DrizzleFollowUpRepository(scoped as any));
}
export class DraftFollowupService {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase) {
    this.operations = new OperationStore(db);
  }
  async closeFollowup(
    p: ConnectionPrincipal,
    key: MutationKey,
    raw: z.infer<typeof closeFollowupSchema>,
  ) {
    requireConnectionScope(p, "followups:write");
    const input = closeFollowupSchema.parse(raw);
    return this.operations.perform(p, `${input.action}_followup`, key, input, async (tx) => {
      // Match profile-merge lock order before locking the reminder itself.
      await profileRow(tx, input.profileId, true);
      const row = (await tx.query(
        "SELECT *,updated_at::text AS revision FROM follow_ups WHERE id=$1 AND organization_id=$2 FOR UPDATE",
        [input.followupId, input.profileId],
      )).rows[0];
      if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
      if (row.revision !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      if (row.completed_at)
        throw new ConnectionError("CONNECTION_FOLLOWUP_CLOSED", 409);
      const result = await followupService(tx).edit({
        followUpId: row.id,
        kind: row.kind,
        dueAt: new Date(row.due_at),
        completed: true,
        outcome: input.action === "dismiss" ? `Dismissed: ${input.reason}` : input.reason,
      });
      if (!result.ok) throw new ConnectionError(result.error.code);
      // Ensure revision changes even for two writes within the same millisecond.
      const saved = (await tx.query(
        "UPDATE follow_ups SET updated_at=GREATEST(clock_timestamp(),$2::timestamptz+interval '1 microsecond') WHERE id=$1 RETURNING *,updated_at::text AS revision",
        [row.id, row.revision],
      )).rows[0];
      return receipt(tx, row.id, `/profiles/${input.profileId}`, saved.revision, followup(saved));
    });
  }
  async saveDraft(
    p: ConnectionPrincipal,
    key: MutationKey,
    input: {
      draftId?: string;
      expectedRevision?: string;
      content: StoredDraftContent;
    },
  ) {
    requireConnectionScope(p, "drafts:write");
    let content: StoredDraftContent;
    try {
      content = cleanDraftContent(input.content);
    } catch {
      throw new ConnectionError("CONNECTION_INVALID_DRAFT");
    }
    if (!content.organizationId || content.batchId)
      throw new ConnectionError("CONNECTION_PROFILE_REQUIRED");
    return this.operations.perform(
      p,
      "save_app_draft",
      key,
      { ...input, content },
      async (tx) => {
        await associations(
          tx,
          content.organizationId!,
          content.contactId,
          content.bookingId,
        );
        if (content.threadId) {
          const match = await tx.query(
            "SELECT t.id FROM google_workspace_profile_email_threads t JOIN google_workspace_profile_email_thread_sources s ON s.conversation_id=t.id AND s.connection_id=t.connection_id WHERE t.organization_id=$1 AND s.gmail_thread_id=$2",
            [content.organizationId, content.threadId],
          );
          if (!match.rows.length)
            throw new ConnectionError("CONNECTION_THREAD_MISMATCH", 409);
        }
        for (let i = 0; i < content.attachmentIds.length; i++) {
          const match = await tx.query(
            `SELECT d.id FROM business_documents d JOIN business_document_versions v ON v.id=d.current_version_id AND v.document_id=d.id JOIN business_document_blobs b ON b.id=v.blob_id AND b.validation_state='accepted' WHERE d.id=$1 AND d.lifecycle<>'deleted' AND b.sha256_hex=$2 AND EXISTS(SELECT 1 FROM business_document_links l LEFT JOIN bookings k ON k.id=l.booking_id WHERE l.document_id=d.id AND (l.organization_id=$3 OR k.organization_id=$3))`,
            [
              content.attachmentIds[i],
              content.attachmentHashes[i],
              content.organizationId,
            ],
          );
          if (!match.rows.length)
            throw new ConnectionError("CONNECTION_ATTACHMENT_MISMATCH", 409);
        }
        if (content.contactId) {
          const row = (
            await tx.query("SELECT email FROM contacts WHERE id=$1", [
              content.contactId,
            ])
          ).rows[0];
          if (
            !row?.email ||
            !content.to.some((e) => e.toLowerCase() === row.email.toLowerCase())
          )
            throw new ConnectionError("CONNECTION_CONTACT_MISMATCH", 409);
        }
        const id = input.draftId ?? randomUUID(),
          revision = randomUUID();
        if (input.draftId) {
          const row = (
            await tx.query(
              "SELECT * FROM chatgpt_external_drafts WHERE id=$1 AND owner_id=$2 AND connection_id=$3 FOR UPDATE",
              [id, p.ownerId, p.connectionId],
            )
          ).rows[0];
          if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
          if (row.revision !== input.expectedRevision)
            throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
          await tx.query(
            "UPDATE chatgpt_external_drafts SET content=$2,revision=$3,updated_at=now() WHERE id=$1",
            [id, JSON.stringify(content), revision],
          );
        } else {
          await tx.query(
            "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,$2,$3,$4,$5)",
            [id, p.ownerId, p.connectionId, JSON.stringify(content), revision],
          );
        }
        return receipt(
          tx,
          id,
          `/settings/chatgpt-connection?draft=${id}`,
          revision,
          { draftId: id },
        );
      },
    );
  }
  async ownerDrafts(ownerId: string) {
    return (
      await this.db.query(
        "SELECT id,content,revision,created_at,updated_at FROM chatgpt_external_drafts WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 50",
        [ownerId],
      )
    ).rows;
  }
  async listFollowups(
    p: ConnectionPrincipal,
    input: { profileId: string; cursor?: string },
  ): Promise<Page<FollowupSummary>> {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    await profileRow(this.db, input.profileId);
    let c: any = null;
    if (input.cursor) {
      try {
        c = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
        if (
          c.profileId !== input.profileId ||
          !z.string().uuid().safeParse(c.id).success ||
          !Number.isFinite(Date.parse(c.at))
        )
          throw Error();
      } catch {
        throw new ConnectionError("CONNECTION_INVALID_CURSOR");
      }
    }
    const rows = (
      await this.db.query(
        "SELECT *,updated_at::text AS revision FROM follow_ups WHERE organization_id=$1 AND ($2::timestamptz IS NULL OR (updated_at,id)<($2::timestamptz,$3::uuid)) ORDER BY updated_at DESC,id DESC LIMIT 21",
        [input.profileId, c?.at ?? null, c?.id ?? null],
      )
    ).rows;
    const items = rows.slice(0, 20),
      last = items.at(-1);
    return {
      items: items.map(followup),
      truncated: rows.length > 20,
      nextCursor:
        rows.length > 20
          ? Buffer.from(
              JSON.stringify({
                profileId: input.profileId,
                id: last.id,
                at: last.revision,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async saveFollowup(
    p: ConnectionPrincipal,
    key: MutationKey,
    input: {
      followupId?: string;
      expectedRevision?: string;
      profileId: string;
      contactId: string | null;
      bookingId: string | null;
      kind: string;
      dueAt: string;
    },
  ) {
    requireConnectionScope(p, "followups:write");
    if (!z.string().datetime({ offset: true }).safeParse(input.dueAt).success)
      throw new ConnectionError(
        "CONNECTION_DUE_DATE_REQUIRED",
        400,
        "Provide an explicit due date with timezone.",
      );
    if (!input.kind?.trim() || input.kind.length > 200)
      throw new ConnectionError("CONNECTION_INVALID_FOLLOWUP");
    return this.operations.perform(
      p,
      "save_followup",
      key,
      input,
      async (tx) => {
        await associations(
          tx,
          input.profileId,
          input.contactId,
          input.bookingId,
        );
        const service = followupService(tx);
        let id: string;
        if (input.followupId) {
          const row = (
            await tx.query(
              "SELECT *,updated_at::text AS revision FROM follow_ups WHERE id=$1 AND organization_id=$2 FOR UPDATE",
              [input.followupId, input.profileId],
            )
          ).rows[0];
          if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
          if (row.revision !== input.expectedRevision || row.completed_at)
            throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
          if (
            row.contact_id !== input.contactId ||
            row.booking_id !== input.bookingId
          )
            throw new ConnectionError(
              "CONNECTION_FOLLOWUP_ASSOCIATION_IMMUTABLE",
              409,
            );
          const result = await service.edit({
            followUpId: row.id,
            kind: input.kind,
            dueAt: new Date(input.dueAt),
            completed: false,
            outcome: null,
          });
          if (!result.ok) throw new ConnectionError(result.error.code);
          id = row.id;
        } else {
          const result = await service.create(
            {
              organizationId: input.profileId,
              contactId: input.contactId,
              bookingId: input.bookingId,
              kind: input.kind,
              dueAt: new Date(input.dueAt),
            },
            { idempotencyId: randomUUID() },
          );
          if (!result.ok) throw new ConnectionError(result.error.code);
          id = result.value.id;
        }
        const row = (
          await tx.query(
            "SELECT *,updated_at::text AS revision FROM follow_ups WHERE id=$1",
            [id],
          )
        ).rows[0];
        return receipt(
          tx,
          id,
          `/profiles/${input.profileId}`,
          row.revision,
          followup(row),
        );
      },
    );
  }
}
