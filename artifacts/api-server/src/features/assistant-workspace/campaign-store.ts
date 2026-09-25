import { createHash } from "node:crypto";
import { z } from "zod";
import type { Queryable, RunContext } from "./contracts";
import { DraftStore, type StoredDraftContent } from "./draft-store";
import { reviewCampaignMember } from "./campaign-eligibility";
import { fingerprint } from "./action-store";
import { transactionQueries } from "./transaction-queries";
export const stableCampaignId = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const campaignMemberSchema = z
  .object({
    organizationId: z.uuid(),
    contactId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
  })
  .strict();
export const campaignInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    eventYear: z.number().int().min(2000).max(2200),
    criteria: z.string().max(2000),
    members: z.array(campaignMemberSchema).min(1).max(100),
  })
  .strict();
export type CampaignMember = z.infer<typeof campaignMemberSchema>;
export type CampaignBatch = {
  id: string;
  title: string;
  eventYear: number;
  criteria: string;
  members: CampaignMember[];
  revision: number;
  cursor: number;
  draftLinks: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};
const map = (r: any): CampaignBatch => ({
  id: r.id,
  title: r.title,
  eventYear: r.event_year,
  criteria: r.criteria,
  members: r.members,
  revision: r.revision,
  cursor: r.cursor,
  draftLinks: r.draft_links,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});
export async function assertSourceMessage(
  q: Queryable,
  context: RunContext,
  id: string,
) {
  if (
    context.actor.role !== "owner" ||
    !(
      await q.query(
        "SELECT id FROM assistant_workspace_messages WHERE id=$1 AND actor_id=$2 AND conversation_id=$3 AND role='user'",
        [id, context.actor.id, context.conversationId],
      )
    ).rows.length
  )
    throw new Error("ASSISTANT_SOURCE_MESSAGE_REQUIRED");
}
export class CampaignStore {
  constructor(
    private database: any,
    private read: Queryable,
  ) {}
  async create(
    context: RunContext,
    sourceMessageId: string,
    raw: unknown,
  ): Promise<CampaignBatch> {
    const input = campaignInputSchema.parse(raw);
    if (
      new Set(input.members.map((m) => m.organizationId)).size !==
      input.members.length
    )
      throw new Error("ASSISTANT_DUPLICATE_BATCH_MEMBER");
    await assertSourceMessage(this.read, context, sourceMessageId);
    const id = stableCampaignId(
        `batch:${context.actor.id}:${context.conversationId}:${sourceMessageId}`,
      ),
      hash = fingerprint(input);
    const row = (
      await this.read.query(
        `INSERT INTO assistant_workspace_campaign_batches(id,actor_id,conversation_id,source_message_id,title,event_year,criteria,input_fingerprint,members) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT(id) DO NOTHING RETURNING *`,
        [
          id,
          context.actor.id,
          context.conversationId,
          sourceMessageId,
          input.title,
          input.eventYear,
          input.criteria,
          hash,
          JSON.stringify(input.members),
        ],
      )
    ).rows[0];
    if (row) return map(row);
    const existing = (
      await this.read.query(
        "SELECT * FROM assistant_workspace_campaign_batches WHERE id=$1 AND actor_id=$2 AND conversation_id=$3",
        [id, context.actor.id, context.conversationId],
      )
    ).rows[0];
    if (!existing || existing.input_fingerprint !== hash)
      throw new Error("ASSISTANT_BATCH_CONFLICT");
    return map(existing);
  }
  async get(
    actor: string,
    conversation: string,
    id: string,
  ): Promise<CampaignBatch | null> {
    const r = (
      await this.read.query(
        "SELECT * FROM assistant_workspace_campaign_batches WHERE actor_id=$1 AND conversation_id=$2 AND id=$3",
        [actor, conversation, id],
      )
    ).rows[0];
    return r ? map(r) : null;
  }
  async list(actor: string, conversation: string): Promise<CampaignBatch[]> {
    return (
      await this.read.query(
        "SELECT * FROM assistant_workspace_campaign_batches WHERE actor_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 100",
        [actor, conversation],
      )
    ).rows.map(map);
  }
  async prepareDraft(
    context: RunContext,
    batchId: string,
    raw: StoredDraftContent,
  ) {
    return this.database.transaction(async (tx: any) => {
      const q = transactionQueries(tx);
      const row = (
        await q.query(
          "SELECT * FROM assistant_workspace_campaign_batches WHERE id=$1 AND actor_id=$2 AND conversation_id=$3 FOR UPDATE",
          [batchId, context.actor.id, context.conversationId],
        )
      ).rows[0];
      if (!row) throw new Error("ASSISTANT_BATCH_NOT_FOUND");
      const batch = map(row),
        member = batch.members.find(
          (m) => m.organizationId === raw.organizationId,
        );
      if (
        context.selection.batchId !== batchId ||
        !member ||
        (context.selection.bookingId &&
          context.selection.bookingId !== member.bookingId) ||
        !context.selection.organizationIds.includes(member.organizationId) ||
        context.selection.eventYear !== batch.eventYear
      )
        throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
      const linked = batch.draftLinks[member.organizationId];
      if (linked) {
        const saved = await new DraftStore(q).get(context.actor.id, linked);
        if (!saved || saved.conversationId !== context.conversationId)
          throw new Error("ASSISTANT_DRAFT_NOT_FOUND");
        return saved;
      }
      await q.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [
        member.organizationId,
      ]);
      await q.query(
        "SELECT c.id,c.email FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id WHERE c.id=$1 AND oc.organization_id=$2 AND oc.active=true FOR SHARE OF c,oc",
        [member.contactId, member.organizationId],
      );
      await q.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(lower(trim(email)),0)) FROM contacts WHERE id=$1",
        [member.contactId],
      );
      const review = await reviewCampaignMember(tx, q, batch, member);
      if (!review.eligible)
        throw new Error("ASSISTANT_CAMPAIGN_MEMBER_BLOCKED");
      if (
        raw.to.length !== 1 ||
        raw.cc.length ||
        raw.to[0].trim().toLowerCase() !== review.email
      )
        throw new Error("ASSISTANT_BATCH_RECIPIENT_MISMATCH");
      const draft = await new DraftStore(q).create(
        context.actor.id,
        context.conversationId,
        {
          ...raw,
          to: [review.email!],
          batchId: batch.id,
          contactId: member.contactId,
          eventYear: batch.eventYear,
          bookingId: member.bookingId,
        },
        stableCampaignId(`batch-draft:${batch.id}:${member.organizationId}`),
      );
      await q.query(
        "UPDATE assistant_workspace_campaign_batches SET draft_links=$2::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",
        [
          batch.id,
          JSON.stringify({
            ...batch.draftLinks,
            [member.organizationId]: draft.id,
          }),
        ],
      );
      return draft;
    });
  }
  async next(context: RunContext, sourceMessageId: string, raw: unknown) {
    const input = z
      .object({
        batchId: z.uuid(),
        revision: z.number().int().positive(),
        size: z.number().int().min(1).max(10),
      })
      .strict()
      .parse(raw);
    return this.database.transaction(async (tx: any) => {
      const q = transactionQueries(tx);
      await assertSourceMessage(q, context, sourceMessageId);
      const row = (
        await q.query(
          "SELECT * FROM assistant_workspace_campaign_batches WHERE id=$1 AND actor_id=$2 AND conversation_id=$3 FOR UPDATE",
          [input.batchId, context.actor.id, context.conversationId],
        )
      ).rows[0];
      if (!row) throw new Error("ASSISTANT_BATCH_NOT_FOUND");
      const requestHash = fingerprint({ size: input.size });
      const prior = (
        await q.query(
          "SELECT * FROM assistant_workspace_campaign_pages WHERE batch_id=$1 AND source_message_id=$2",
          [input.batchId, sourceMessageId],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_fingerprint !== requestHash)
          throw new Error("ASSISTANT_PAGE_CONFLICT");
        return {
          batch: map(row),
          start: prior.start_index,
          end: prior.end_index,
          members: row.members.slice(
            prior.start_index,
            prior.end_index,
          ) as CampaignMember[],
        };
      }
      if (row.revision !== input.revision)
        throw new Error("ASSISTANT_VERSION_CONFLICT");
      const start = row.cursor,
        end = Math.min(start + input.size, row.members.length);
      await q.query(
        "INSERT INTO assistant_workspace_campaign_pages(batch_id,source_message_id,request_fingerprint,start_index,end_index) VALUES($1,$2,$3,$4,$5)",
        [input.batchId, sourceMessageId, requestHash, start, end],
      );
      const saved = (
        await q.query(
          "UPDATE assistant_workspace_campaign_batches SET cursor=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",
          [input.batchId, end],
        )
      ).rows[0];
      return {
        batch: map(saved),
        start,
        end,
        members: row.members.slice(start, end) as CampaignMember[],
      };
    });
  }
}
