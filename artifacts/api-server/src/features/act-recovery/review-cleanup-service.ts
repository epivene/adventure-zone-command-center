import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { explicitLinkedTarget, shouldDropLinkedToReview, type ExplicitLinkedTarget } from "./review-cleanup";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;
type Executor = Pick<DrizzleDatabase, "execute">;

export type ActRecoveryCleanupRetrySummary = {
  reviewed: number;
  autoAssignedLinkedTo: number;
  droppedLinkedTo: number;
  retried: number;
};

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function uniqueActLinkedTarget(
  executor: Executor,
  clue: ExplicitLinkedTarget,
): Promise<string | null> {
  const result = clue.entityType === "organization"
    ? rows(await executor.execute(sql`
        select organization.id
        from organizations organization
        where lower(btrim(organization.name)) = lower(btrim(${clue.name}))
          and (
            organization.act_record_id is not null
            or exists (
              select 1 from act_external_links link
              where link.entity_type = 'organization' and link.entity_id = organization.id
            )
          )
        order by organization.id
        limit 2
      `))
    : clue.entityType === "contact"
      ? rows(await executor.execute(sql`
          select contact.id
          from contacts contact
          where lower(btrim(concat_ws(' ', contact.first_name, contact.last_name))) = lower(btrim(${clue.name}))
            and (
              contact.act_record_id is not null
              or exists (
                select 1 from act_external_links link
                where link.entity_type = 'contact' and link.entity_id = contact.id
              )
            )
          order by contact.id
          limit 2
        `))
      : rows(await executor.execute(sql`
          select booking.id
          from bookings booking
          where lower(btrim(booking.name)) = lower(btrim(${clue.name}))
            and (
              booking.act_record_id is not null
              or exists (
                select 1 from act_external_links link
                where link.entity_type = 'booking' and link.entity_id = booking.id
              )
            )
          order by booking.id
          limit 2
        `));
  return result.length === 1 ? text(result[0]?.id) : null;
}

export class ActRecoveryReviewCleanupService {
  constructor(private readonly database: DrizzleDatabase) {}

  async cleanupAndRetry(decidedBy = "owner"): Promise<ActRecoveryCleanupRetrySummary> {
    return this.database.transaction(async (transaction) => {
      const runRows = rows(await transaction.execute(sql`
        select id
        from act_archive_recovery_runs
        order by created_at desc, id desc
        limit 1
        for update
      `));
      const runId = text(runRows[0]?.id);
      if (!runId) return { reviewed: 0, autoAssignedLinkedTo: 0, droppedLinkedTo: 0, retried: 0 };

      const reviewRows = rows(await transaction.execute(sql`
        select item.id as "itemId", item.source_record_id as "sourceRecordId",
          item.source_version_id as "sourceVersionId", item.stream_type as "streamType",
          version.raw_snapshot as "rawSnapshot"
        from act_archive_recovery_items item
        inner join act_source_record_versions version on version.id = item.source_version_id
        where item.run_id = ${runId} and item.state = 'needs_review'
        order by item.priority, item.source_record_id
        for update of item
      `));

      let autoAssignedLinkedTo = 0;
      let droppedLinkedTo = 0;
      let retried = 0;

      for (const row of reviewRows) {
        const itemId = text(row.itemId);
        const sourceRecordId = text(row.sourceRecordId);
        const sourceVersionId = text(row.sourceVersionId);
        const streamType = text(row.streamType);
        const rawSnapshot = object(row.rawSnapshot);
        const linkedTarget = explicitLinkedTarget({ streamType, rawSnapshot });

        if (linkedTarget) {
          const targetEntityId = await uniqueActLinkedTarget(transaction as unknown as Executor, linkedTarget);
          if (targetEntityId) {
            await transaction.execute(sql`
              insert into act_archive_recovery_decisions
                (run_id, source_record_id, source_version_id, decision,
                 target_entity_type, target_entity_id, decided_by)
              values (${runId}, ${sourceRecordId}, ${sourceVersionId}, 'assign_parent',
                ${linkedTarget.entityType}, ${targetEntityId}, ${decidedBy})
            `);
            await transaction.execute(sql`
              update act_archive_recovery_items
              set state = 'pending',
                target_summary = ${JSON.stringify({ reason: "explicit_linked_to_autoresolve", linkedName: linkedTarget.name })}::jsonb,
                last_error_code = null, retry_after = null, completed_at = null,
                lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
              where id = ${itemId}
            `);
            autoAssignedLinkedTo += 1;
            retried += 1;
            continue;
          }
        }

        if (shouldDropLinkedToReview({ streamType, rawSnapshot })) {
          await transaction.execute(sql`
            insert into act_archive_recovery_decisions
              (run_id, source_record_id, source_version_id, decision, decided_by)
            values (${runId}, ${sourceRecordId}, ${sourceVersionId}, 'drop_unusable', ${decidedBy})
          `);
          await transaction.execute(sql`
            update act_archive_recovery_items
            set state = 'dropped_unusable',
              target_summary = ${JSON.stringify({ reason: "linked_to_bookkeeping_cleanup" })}::jsonb,
              completed_at = now(), last_error_code = null, retry_after = null,
              lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
            where id = ${itemId}
          `);
          droppedLinkedTo += 1;
          continue;
        }

        await transaction.execute(sql`
          update act_archive_recovery_items
          set state = 'pending', target_summary = '{}'::jsonb,
            last_error_code = null, retry_after = null, completed_at = null,
            lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
          where id = ${itemId}
        `);
        retried += 1;
      }

      if (retried > 0) {
        await transaction.execute(sql`
          update act_archive_recovery_runs
          set state = 'running', completed_at = null, updated_at = now()
          where id = ${runId}
        `);
      }

      return {
        reviewed: reviewRows.length,
        autoAssignedLinkedTo,
        droppedLinkedTo,
        retried,
      };
    });
  }
}
