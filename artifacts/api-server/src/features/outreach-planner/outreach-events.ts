import { sql } from "drizzle-orm";
import {
  allocationEnabled,
  type AllocationDatabase,
} from "./outreach-allocation";
import { readOutreachSources, rowsOf } from "./outreach-sources";
import type { OpeningDTO, SourceChoice } from "./outreach-dto";

const stages = ["initial", "follow_up_1", "follow_up_2"] as const;
export function nextActualStage(
  sources: SourceChoice[],
  attempts: { source_id: string; stage: string; occurred_at: string }[],
  now: Date,
) {
  const unlinked = sources
    .filter(
      (s) =>
        s.eligible &&
        new Date(s.occurredAt) <= now &&
        !attempts.some((a) => a.source_id === s.id),
    )
    .sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
    );
  const source = unlinked[0];
  if (
    !source?.explicitStage ||
    source.explicitStage !== stages[attempts.length] ||
    attempts.some((a) => new Date(a.occurred_at) >= new Date(source.occurredAt))
  )
    return null;
  return source;
}
// Actual sent/call rows are the durable outbox: this repair can be replayed after
// any hook failure. It creates only canonical history, never another next action.
export async function replayActualOutreach(
  db: AllocationDatabase,
  opportunityId?: string,
) {
  if (!allocationEnabled()) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(908092026)`);
    const candidates = rowsOf<{
      id: string;
      opportunity_id: string;
      opening: OpeningDTO;
    }>(
      await tx.execute(
        sql`select c.id,c.opportunity_id,jsonb_build_object('id',w.id,'startsOn',w.starts_on,'endsOn',w.ends_on,'legId',w.leg_id,'quantities',w.quantities) as opening from outreach_candidates c join outreach_openings w on w.id=c.opening_id where c.released_at is null and w.status='open' and (${opportunityId ?? null}::uuid is null or c.opportunity_id=${opportunityId ?? null}::uuid)`,
      ),
    );
    const now = new Date();
    for (const c of candidates) {
      if (
        candidates.filter((x) => x.opportunity_id === c.opportunity_id)
          .length !== 1
      )
        continue;
      const sources = await readOutreachSources(
        tx,
        c.opportunity_id,
        c.opening,
        now,
      );
      if (
        sources.protectedReason ||
        sources.observedConversationAt ||
        sources.observedInterestAt
      )
        continue;
      const attempts = rowsOf<{
        source_id: string;
        stage: string;
        occurred_at: string;
      }>(
        await tx.execute(
          sql`select source_id,stage,occurred_at from outreach_attempts where candidate_id=${c.id}::uuid order by occurred_at`,
        ),
      );
      const reviews = rowsOf<{ source_id: string }>(
        await tx.execute(
          sql`select source_id from outreach_source_reviews where candidate_id=${c.id}::uuid`,
        ),
      );
      const choices = sources.choices.filter(
        (s) => !reviews.some((r) => r.source_id === s.id),
      );
      let source = nextActualStage(choices, attempts, now);
      while (source) {
        const inserted = rowsOf(
          await tx.execute(
            sql`insert into outreach_attempts(candidate_id,source_id,stage,occurred_at,actor) values (${c.id}::uuid,${source.id},${source.explicitStage},${new Date(source.occurredAt)},'actual-outreach-event') on conflict do nothing returning id`,
          ),
        );
        if (!inserted.length) break;
        await tx.execute(
          sql`insert into outreach_audit(actor,action,entity_id,detail) values ('system','replay_actual_outreach',${c.id}::uuid,${JSON.stringify({ sourceId: source.id, stage: source.explicitStage })}::jsonb)`,
        );
        attempts.push({
          source_id: source.id,
          stage: source.explicitStage!,
          occurred_at: source.occurredAt,
        });
        source = nextActualStage(choices, attempts, now);
      }
    }
  });
}
