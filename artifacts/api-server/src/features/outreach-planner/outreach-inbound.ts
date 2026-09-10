import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  allocationEnabled,
  type AllocationDatabase,
} from "./outreach-allocation";
import { OutreachError } from "./outreach-repository";
import { rowsOf } from "./outreach-sources";
import type { GoogleValidationRow } from "../google-workspace/google-recent-validation-service";
export async function observeInboundOutreach(
  db: AllocationDatabase,
  messages: GoogleValidationRow[],
  now = new Date(),
) {
  if (!allocationEnabled()) return;
  for (const m of messages) {
    if (
      !m.resolvedOrganization ||
      m.labelIds.some((l) => ["SENT", "DRAFT"].includes(l))
    )
      continue;
    const receivedAt =
      m.internalDateMs === null ? null : new Date(m.internalDateMs);
    const actualAt =
      receivedAt && Number.isFinite(receivedAt.getTime()) && receivedAt <= now
        ? receivedAt
        : null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(908092026)`);
      const matches = rowsOf<{ opportunity_id: string; event_year: number }>(
        await tx.execute(
          sql`select distinct opportunity_id,event_year from booking_opportunity_email_state where organization_id=${m.resolvedOrganization!.id}::uuid and state='sent' and sent_at is not null and gmail_thread_id=${m.threadId} and (${actualAt}::timestamptz is null or sent_at<=${actualAt})`,
        ),
      );
      const exact = actualAt && matches.length === 1 ? matches[0] : null;
      await tx.execute(
        sql`insert into outreach_inbound_observations(message_id,thread_id,organization_id,opportunity_id,event_year,received_at,metadata) values (${m.id},${m.threadId},${m.resolvedOrganization!.id}::uuid,${exact?.opportunity_id ?? null}::uuid,${exact?.event_year ?? null},${actualAt},${JSON.stringify({ from: m.from, to: m.to, labelIds: m.labelIds, evidenceCodes: m.evidenceCodes })}::jsonb) on conflict(message_id,organization_id) do nothing`,
      );
    });
  }
}
export async function reviewInboundObservation(
  db: AllocationDatabase,
  id: string,
  body: unknown,
  actor: string,
) {
  if (!allocationEnabled())
    throw new OutreachError(404, "Outreach planner is disabled.");
  const input = z
    .object({
      classification: z.enum(["meaningful_reply", "conversation", "not_reply"]),
      opportunityId: z.string().uuid().nullable(),
      reason: z.string().trim().min(1).max(2000),
      sourceReference: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(body);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(908092026)`);
    const [row] = rowsOf<any>(
      await tx.execute(
        sql`select * from outreach_inbound_observations where id=${id}::uuid`,
      ),
    );
    if (!row) throw new OutreachError(404, "Inbound observation not found.");
    if (
      input.classification !== "not_reply" &&
      (!input.opportunityId || !row.received_at)
    )
      throw new OutreachError(
        409,
        "Review the actual received time and exact event-year opportunity first.",
      );
    if (input.opportunityId) {
      const [op] = rowsOf<any>(
        await tx.execute(
          sql`select organization_id,event_year from booking_opportunities where id=${input.opportunityId}::uuid`,
        ),
      );
      if (
        !op ||
        op.organization_id !== row.organization_id ||
        (row.opportunity_id && row.opportunity_id !== input.opportunityId)
      )
        throw new OutreachError(
          409,
          "Opportunity does not match the observed profile/thread identity.",
        );
    }
    await tx.execute(
      sql`update outreach_inbound_observations set state='reviewed',classification=${input.classification},reviewed_opportunity_id=${input.opportunityId}::uuid,reviewed_at=now(),actor=${actor},reason=${input.reason},source_reference=${input.sourceReference} where id=${id}::uuid`,
    );
    await tx.execute(
      sql`insert into outreach_audit(actor,action,entity_id,detail) values (${actor},'review_inbound_outreach',${id}::uuid,${JSON.stringify(input)}::jsonb)`,
    );
    return { id, state: "reviewed", classification: input.classification };
  });
}
