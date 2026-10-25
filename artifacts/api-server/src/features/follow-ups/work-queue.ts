import { z } from "zod";
import {
  queueBuckets,
  type QueuePage,
  type WorkflowSql,
} from "./workflow-types";

export const WORK_QUEUE_TIME_ZONE = "America/Denver";
export const queueInput = z
  .object({
    bucket: z.enum(queueBuckets).default("overdue"),
    days: z.coerce
      .number()
      .int()
      .refine((v) => v === 3 || v === 7)
      .default(7),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

// Calendar dates are evaluated by PostgreSQL in Mountain time, including DST.
// No row cap precedes counting or bucket selection.
const candidates = `WITH candidates AS (
 SELECT f.id,'followup' source,f.updated_at::text revision,
   COALESCE(f.organization_id,b.organization_id) organization_id,f.contact_id,f.booking_id,
   COALESCE(o.name,b.name,'Contact follow-up') name,f.kind next_action,f.due_at,b.status::text status,
   COALESCE(fp.event_year,extract(year FROM b.starts_at AT TIME ZONE $2)::int) event_year,f.opportunity_id
 FROM follow_ups f LEFT JOIN bookings b ON b.id=f.booking_id
 LEFT JOIN booking_opportunities fp ON fp.id=f.opportunity_id
 LEFT JOIN organizations o ON o.id=COALESCE(f.organization_id,b.organization_id)
 WHERE f.completed_at IS NULL
 UNION ALL
 SELECT b.id,'booking',b.updated_at::text,b.organization_id,b.primary_contact_id,b.id,
   b.name,'Choose the next action',NULL::timestamptz,b.status::text,extract(year FROM b.starts_at AT TIME ZONE $2)::int,NULL::uuid
 FROM bookings b
 WHERE b.status::text NOT IN ('declined','cancelled','completed')
 AND NOT EXISTS(SELECT 1 FROM booking_opportunities p WHERE p.booking_id=b.id)
 AND NOT EXISTS(SELECT 1 FROM follow_ups f WHERE f.booking_id=b.id AND f.completed_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.booking_id=b.id AND a.deleted_at IS NULL
   AND a.subject='Next step: booking:'||b.id::text AND a.status='no_further_action' AND a.occurred_at>=b.updated_at)
 UNION ALL
 SELECT p.id,'opportunity',p.updated_at::text,p.organization_id,p.contact_id,p.booking_id,
   o.name,COALESCE(p.next_action_kind,'Choose the next action'),p.next_action_due_at,p.status,p.event_year,p.id
 FROM booking_opportunities p JOIN organizations o ON o.id=p.organization_id
 WHERE p.status NOT IN ('not_pursuing','declined','cancelled','territory_hold')
 AND p.event_year>=extract(year FROM $1::timestamptz AT TIME ZONE $2)::int
 AND NOT EXISTS(SELECT 1 FROM follow_ups f WHERE f.completed_at IS NULL AND
   (f.opportunity_id=p.id OR (f.opportunity_id IS NULL AND f.booking_id=p.booking_id AND f.kind=p.next_action_kind AND f.due_at=p.next_action_due_at)))
 AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.organization_id=p.organization_id AND a.deleted_at IS NULL
   AND a.subject='Next step: opportunity:'||p.id::text AND a.status='no_further_action' AND a.occurred_at>=p.updated_at)
 UNION ALL
 SELECT e.id,'conversation',e.revision::text,e.profile_id,NULL::uuid,NULL::uuid,
   o.name,CASE WHEN e.state='needs_your_reply' THEN 'Reply: ' ELSE 'Follow up: ' END||e.subject,e.due_at,e.state,e.event_year,NULL::uuid
 FROM email_thread_attention e JOIN organizations o ON o.id=e.profile_id
 WHERE e.state<>'resolved'
 AND NOT EXISTS(SELECT 1 FROM follow_ups f WHERE f.id=e.followup_id AND f.completed_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM activities a WHERE a.organization_id=e.profile_id AND a.deleted_at IS NULL
   AND a.subject='Next step: conversation:'||e.id::text AND a.status='no_further_action' AND a.occurred_at>=e.updated_at)
), classified AS (
 SELECT *,CASE WHEN due_at IS NULL THEN 'needsNextStep'
 WHEN (due_at AT TIME ZONE $2)::date < ($1::timestamptz AT TIME ZONE $2)::date THEN 'overdue'
 WHEN (due_at AT TIME ZONE $2)::date = ($1::timestamptz AT TIME ZONE $2)::date THEN 'today'
 ELSE 'upcoming' END bucket
 FROM candidates
 WHERE due_at IS NULL OR (due_at AT TIME ZONE $2)::date <= ($1::timestamptz AT TIME ZONE $2)::date+$3::int
)`;

export async function listWorkQueue(
  db: WorkflowSql,
  raw: z.input<typeof queueInput>,
  now: Date,
): Promise<QueuePage> {
  const input = queueInput.parse(raw);
  const args = [now.toISOString(), WORK_QUEUE_TIME_ZONE, input.days];
  // One statement gives both counts and rows a single consistent snapshot.
  const result = await db.query(
    `${candidates}
    SELECT (SELECT COALESCE(jsonb_object_agg(bucket,n),'{}') FROM
      (SELECT bucket,count(*)::int n FROM classified GROUP BY bucket) counts) counts,
    (SELECT COALESCE(jsonb_agg(to_jsonb(page)),'[]') FROM
      (SELECT * FROM classified WHERE bucket=$4 ORDER BY due_at NULLS FIRST,name,source,id LIMIT $5 OFFSET $6) page) items`,
    [...args, input.bucket, input.limit, input.offset],
  );
  const counts = {
    needsNextStep: 0,
    overdue: 0,
    today: 0,
    upcoming: 0,
    ...result.rows[0].counts,
  };
  return {
    items: result.rows[0].items.map((r: any) => ({
      id: r.id,
      source: r.source,
      revision: r.revision,
      bucket: r.bucket,
      organizationId: r.organization_id,
      contactId: r.contact_id,
      bookingId: r.booking_id,
      eventYear: r.event_year,
      opportunityId: r.opportunity_id,
      name: r.name,
      nextAction: r.next_action,
      dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
      status: r.status,
    })),
    total: counts[input.bucket],
    counts,
    offset: input.offset,
    limit: input.limit,
    timeZone: WORK_QUEUE_TIME_ZONE,
    checkedAt: now.toISOString(),
  };
}
