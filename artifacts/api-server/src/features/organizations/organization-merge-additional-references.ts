import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;
export type OrganizationMergeTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

export async function reparentAdditionalOrganizationReferences(
  transaction: OrganizationMergeTransaction,
  primaryId: string,
  duplicateId: string,
): Promise<void> {
  await transaction.execute(sql`
    UPDATE office_tasks SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};
    UPDATE office_mail_activity SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};
    UPDATE office_email_drafts SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};

    UPDATE lead_import_rows SET selected_organization_id = ${primaryId}, updated_at = now()
    WHERE selected_organization_id = ${duplicateId};
    UPDATE lead_gmail_draft_links SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};

    WITH active_conflicts AS (
      SELECT duplicate_block.id AS duplicate_id, surviving_block.id AS surviving_id
      FROM communication_blocks duplicate_block
      JOIN communication_blocks surviving_block
        ON surviving_block.target_type = 'organization'
       AND surviving_block.organization_id = ${primaryId}
       AND surviving_block.active
      WHERE duplicate_block.target_type = 'organization'
        AND duplicate_block.organization_id = ${duplicateId}
        AND duplicate_block.active
    )
    UPDATE communication_block_events event
    SET block_id = active_conflicts.surviving_id
    FROM active_conflicts
    WHERE event.block_id = active_conflicts.duplicate_id;

    DELETE FROM communication_blocks duplicate_block
    USING communication_blocks surviving_block
    WHERE duplicate_block.target_type = 'organization'
      AND duplicate_block.organization_id = ${duplicateId}
      AND duplicate_block.active
      AND surviving_block.target_type = 'organization'
      AND surviving_block.organization_id = ${primaryId}
      AND surviving_block.active;

    UPDATE communication_blocks SET organization_id = ${primaryId}
    WHERE target_type = 'organization' AND organization_id = ${duplicateId};

    UPDATE paper_note_entries
    SET selected_organization_id = ${primaryId}, updated_at = now()
    WHERE selected_organization_id = ${duplicateId};
    UPDATE paper_note_entries
    SET imported_organization_id = ${primaryId}, updated_at = now()
    WHERE imported_organization_id = ${duplicateId};
    UPDATE organization_phones SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};

    UPDATE event_attendance_history SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId};

    DELETE FROM business_source_document_links duplicate_link
    USING business_source_document_links surviving_link
    WHERE duplicate_link.organization_id = ${duplicateId}
      AND surviving_link.organization_id = ${primaryId}
      AND surviving_link.source_document_id = duplicate_link.source_document_id;
    UPDATE business_source_document_links SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId};
  `);

  await transaction.execute(sql`
    UPDATE booking_opportunity_email_state duplicate_email
    SET state = 'cancelled', updated_at = now()
    FROM booking_opportunities duplicate_opportunity
    JOIN booking_opportunities surviving_opportunity
      ON surviving_opportunity.organization_id = ${primaryId}
     AND surviving_opportunity.event_year = duplicate_opportunity.event_year
    WHERE duplicate_opportunity.organization_id = ${duplicateId}
      AND duplicate_email.opportunity_id = duplicate_opportunity.id
      AND duplicate_email.state IN ('draft', 'scheduled', 'failed')
      AND EXISTS (
        SELECT 1 FROM booking_opportunity_email_state surviving_email
        WHERE surviving_email.opportunity_id = surviving_opportunity.id
          AND surviving_email.state IN ('draft', 'scheduled', 'failed')
      );

    UPDATE booking_opportunity_email_state duplicate_email
    SET opportunity_id = surviving_opportunity.id,
        organization_id = ${primaryId},
        event_year = surviving_opportunity.event_year,
        updated_at = now()
    FROM booking_opportunities duplicate_opportunity
    JOIN booking_opportunities surviving_opportunity
      ON surviving_opportunity.organization_id = ${primaryId}
     AND surviving_opportunity.event_year = duplicate_opportunity.event_year
    WHERE duplicate_opportunity.organization_id = ${duplicateId}
      AND duplicate_email.opportunity_id = duplicate_opportunity.id;

    INSERT INTO booking_opportunity_queue_overrides
      (opportunity_id, business_date, pinned, manual_order, snoozed_until, created_at, updated_at)
    SELECT surviving_opportunity.id, duplicate_override.business_date,
           duplicate_override.pinned, duplicate_override.manual_order,
           duplicate_override.snoozed_until, duplicate_override.created_at, now()
    FROM booking_opportunity_queue_overrides duplicate_override
    JOIN booking_opportunities duplicate_opportunity
      ON duplicate_opportunity.id = duplicate_override.opportunity_id
    JOIN booking_opportunities surviving_opportunity
      ON surviving_opportunity.organization_id = ${primaryId}
     AND surviving_opportunity.event_year = duplicate_opportunity.event_year
    WHERE duplicate_opportunity.organization_id = ${duplicateId}
    ON CONFLICT (opportunity_id, business_date) DO UPDATE SET
      pinned = booking_opportunity_queue_overrides.pinned OR EXCLUDED.pinned,
      manual_order = COALESCE(booking_opportunity_queue_overrides.manual_order, EXCLUDED.manual_order),
      snoozed_until = GREATEST(booking_opportunity_queue_overrides.snoozed_until, EXCLUDED.snoozed_until),
      updated_at = now();

    DELETE FROM booking_opportunities duplicate_opportunity
    USING booking_opportunities surviving_opportunity
    WHERE duplicate_opportunity.organization_id = ${duplicateId}
      AND surviving_opportunity.organization_id = ${primaryId}
      AND surviving_opportunity.event_year = duplicate_opportunity.event_year;

    UPDATE booking_opportunities SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};
    UPDATE booking_opportunity_email_state SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId};
  `);

  await transaction.execute(sql`
    DO $merge_optional_references$
    BEGIN
      IF to_regclass(current_schema() || '.derived_crm_facts') IS NOT NULL THEN
        UPDATE derived_crm_facts SET organization_id = ${primaryId}, updated_at = now()
        WHERE organization_id = ${duplicateId};
      END IF;
      IF to_regclass(current_schema() || '.profile_research_runs') IS NOT NULL THEN
        UPDATE profile_research_runs SET profile_id = ${primaryId}, updated_at = now()
        WHERE profile_id = ${duplicateId};
      END IF;
      IF to_regclass(current_schema() || '.lead_scout_candidates') IS NOT NULL THEN
        UPDATE lead_scout_candidates SET matched_organization_id = ${primaryId}, updated_at = now()
        WHERE matched_organization_id = ${duplicateId};
        UPDATE lead_scout_candidates SET saved_organization_id = ${primaryId}, updated_at = now()
        WHERE saved_organization_id = ${duplicateId};
      END IF;
      IF to_regclass(current_schema() || '.scout_alert_watches') IS NOT NULL THEN
        UPDATE scout_alert_watches SET organization_id = ${primaryId}, updated_at = now()
        WHERE organization_id = ${duplicateId};
        UPDATE scout_alerts SET organization_id = ${primaryId}, updated_at = now()
        WHERE organization_id = ${duplicateId};
      END IF;
    END
    $merge_optional_references$;
  `);
}