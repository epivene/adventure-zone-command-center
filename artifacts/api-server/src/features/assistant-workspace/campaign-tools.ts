import { z } from "zod";
import type { Queryable, ToolRegistry } from "./contracts";
import type { ConversationStore } from "./conversation-store";
import type { RunStore } from "./run-store";
import type { ActionExecutor } from "./action-executor";
import type { ModelConfig } from "./model-config";
import {
  CampaignStore,
  campaignInputSchema,
  stableCampaignId,
} from "./campaign-store";
import { reviewCampaignMember } from "./campaign-eligibility";
import { researchPublicSources, ResearchCallStore } from "./public-research";
import { sendFollowupSchema } from "./campaign-actions";
import { blocked, result } from "./read-tools";
const schemas = {
  create_campaign_batch: campaignInputSchema,
  list_campaign_batches: z.object({}).strict(),
  select_campaign_batch: z.object({ batchId: z.uuid().nullable() }).strict(),
  next_campaign_page: z
    .object({
      batchId: z.uuid(),
      revision: z.number().int().positive(),
      size: z.number().int().min(1).max(10),
    })
    .strict(),
  review_campaign_members: z
    .object({
      batchId: z.uuid(),
      organizationIds: z.array(z.uuid()).min(1).max(10),
    })
    .strict(),
  research_public_sources: z
    .object({ query: z.string().trim().min(1).max(2000) })
    .strict(),
  create_send_followup: z
    .object({
      targetId: z.uuid(),
      expectedRevision: z.string().min(1),
      values: sendFollowupSchema,
    })
    .strict(),
};
export function createCampaignTools(deps: {
  ownerId: string;
  database: any;
  db: Queryable;
  campaigns: CampaignStore;
  conversations: ConversationStore;
  runs: RunStore;
  executor: ActionExecutor;
  config: ModelConfig;
}): ToolRegistry {
  return {
    definitions(c) {
      if (c.actor.id !== deps.ownerId || c.actor.role !== "owner") return [];
      return Object.entries(schemas).map(([name, schema]) => ({
        type: "function",
        name,
        description:
          name === "research_public_sources"
            ? "Research a public question with the conversation model. Do not include private email, documents or confidential app content in the query. Report incomplete evidence. Public discoveries need reviewed CRM intake before campaign membership."
            : name === "next_campaign_page"
              ? "Get the next saved group of 1–10 leads. At most one page per user message; repeating this call returns the same members. Drafts and sending are separate reviewed steps."
              : `Perform ${name.replaceAll("_", " ")}. Saved membership and event year are immutable. Review current eligibility before drafting. No bulk sends.`,
        parameters: z.toJSONSchema(schema, { io: "input" }),
        strict: false,
      }));
    },
    async execute(c, call) {
      if (
        c.actor.id !== deps.ownerId ||
        c.actor.role !== "owner" ||
        c.signal.aborted
      )
        return blocked("ASSISTANT_ACCESS_DENIED");
      const schema = schemas[call.name as keyof typeof schemas];
      if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
      let a: any;
      try {
        a = schema.parse(JSON.parse(call.arguments));
      } catch {
        return blocked("ASSISTANT_ARGUMENTS_INVALID");
      }
      try {
        const run = await deps.runs.get(c.actor.id, c.runId);
        if (!run || run.conversationId !== c.conversationId)
          return blocked("ASSISTANT_RUN_NOT_FOUND");
        const select = async (
          batchId: string | null,
          organizationIds: string[],
          eventYear: number | null,
        ) => {
          const current = await deps.conversations.get(
            c.actor.id,
            c.conversationId,
          );
          if (!current) throw new Error("ASSISTANT_CONVERSATION_NOT_FOUND");
          const saved = await deps.conversations.setSelection(
            c.actor.id,
            c.conversationId,
            current.version,
            {
              ...current.selection,
              batchId,
              organizationIds,
              eventYear,
              bookingId: null,
              draftId: null,
              threadId: null,
            },
          );
          Object.assign(c.selection, saved.selection);
        };
        if (call.name === "list_campaign_batches")
          return result(
            await deps.campaigns.list(c.actor.id, c.conversationId),
          );
        if (call.name === "create_campaign_batch") {
          if (
            a.members.some(
              (m: any) =>
                !c.selection.organizationIds.includes(m.organizationId),
            )
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          const batch = await deps.campaigns.create(
            c,
            run.input.sourceMessageId,
            a,
          );
          await select(batch.id, [], batch.eventYear);
          return result(batch);
        }
        if (call.name === "select_campaign_batch") {
          if (!a.batchId) {
            await select(
              null,
              c.selection.organizationIds,
              c.selection.eventYear,
            );
            return result(c.selection);
          }
          const batch = await deps.campaigns.get(
            c.actor.id,
            c.conversationId,
            a.batchId,
          );
          if (!batch) return blocked("ASSISTANT_BATCH_NOT_FOUND");
          const page = (
            await deps.db.query(
              "SELECT start_index,end_index FROM assistant_workspace_campaign_pages WHERE batch_id=$1 ORDER BY end_index DESC,start_index DESC LIMIT 1",
              [batch.id],
            )
          ).rows[0];
          await select(
            batch.id,
            page
              ? batch.members
                  .slice(page.start_index, page.end_index)
                  .map((m) => m.organizationId)
              : [],
            batch.eventYear,
          );
          return result({ batch, selection: c.selection });
        }
        if (call.name === "next_campaign_page") {
          const page = await deps.campaigns.next(
            c,
            run.input.sourceMessageId,
            a,
          );
          await select(
            page.batch.id,
            page.members.map(
              (m: { organizationId: string }) => m.organizationId,
            ),
            page.batch.eventYear,
          );
          return result(page);
        }
        if (call.name === "review_campaign_members") {
          const batch = await deps.campaigns.get(
            c.actor.id,
            c.conversationId,
            a.batchId,
          );
          if (!batch || c.selection.batchId !== batch.id)
            return blocked("ASSISTANT_BATCH_NOT_FOUND");
          const members = a.organizationIds.map((id: string) =>
            batch.members.find((m) => m.organizationId === id),
          );
          if (
            members.some(
              (m: any) =>
                !m || !c.selection.organizationIds.includes(m.organizationId),
            )
          )
            return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
          const reviews = [];
          for (const m of members)
            reviews.push(
              await reviewCampaignMember(deps.database, deps.db, batch, m, {
                ignoreDraftId: batch.draftLinks[m.organizationId],
              }),
            );
          return result({
            view: "campaign_review",
            batchId: batch.id,
            reviews,
          });
        }
        if (call.name === "research_public_sources") {
          const model = run.input.model ?? deps.config.model;
          return new ResearchCallStore(deps.db).execute(
            c,
            call.id,
            { query: a.query, model },
            () => researchPublicSources(deps.config, model, a.query, c.signal),
          );
        }
        return deps.executor.execute(c, {
          id: stableCampaignId(`${c.runId}:${call.id}`),
          actorId: c.actor.id,
          conversationId: c.conversationId,
          sourceMessageId: run.input.sourceMessageId,
          kind: call.name,
          targetId: a.targetId,
          expectedRevision: a.expectedRevision,
          connectionId: null,
          arguments: a.values,
        });
      } catch (e) {
        return blocked(
          e instanceof Error && e.message.startsWith("ASSISTANT_")
            ? e.message
            : "ASSISTANT_TOOL_FAILED",
        );
      }
    },
  };
}
const reviewCard = z.object({
  eligible: z.boolean(),
  member: z.object({
    organizationId: z.uuid(),
    contactId: z.uuid().nullable(),
    bookingId: z.uuid().nullable(),
  }),
  profileName: z.string().nullable(),
  reasons: z.array(z.string()),
  cautions: z.array(z.string()),
  checkedAt: z.string(),
  blockedRecords: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      state: z.string(),
      eventYear: z.number().nullable(),
    }),
  ),
  openFollowups: z.array(
    z.object({ id: z.string(), kind: z.string().nullable(), dueAt: z.any() }),
  ),
});
export function publicCampaignReviews(runs: any[]) {
  const seen = new Set<string>();
  return runs
    .flatMap((run) =>
      Object.values(run.turn?.results ?? {})
        .reverse()
        .flatMap((r: any) => {
          if (
            r.data?.view !== "campaign_review" ||
            !z.uuid().safeParse(r.data.batchId).success
          )
            return [];
          return (r.data.reviews ?? []).flatMap((raw: any) => {
            const parsed = reviewCard.safeParse(raw);
            if (!parsed.success) return [];
            const key = `${r.data.batchId}:${parsed.data.member.organizationId}`;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ batchId: r.data.batchId, ...parsed.data }];
          });
        }),
    )
    .slice(0, 100);
}
