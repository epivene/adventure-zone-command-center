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
  // node-postgres sends prepared statements through PostgreSQL's extended
  // protocol, which accepts one command per statement. Keep each update
  // separate so the merge works against the real driver as well as PGlite.
  await transaction.execute(sql`
    UPDATE office_tasks SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE office_mail_activity SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE office_email_drafts SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE lead_import_rows SET selected_organization_id = ${primaryId}, updated_at = now()
    WHERE selected_organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE lead_gmail_draft_links SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
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
    WHERE event.block_id = active_conflicts.duplicate_id
  `);
  await transaction.execute(sql`
    DELETE FROM communication_blocks duplicate_block
    USING communication_blocks surviving_block
    WHERE duplicate_block.target_type = 'organization'
      AND duplicate_block.organization_id = ${duplicateId}
      AND duplicate_block.active
      AND surviving_block.target_type = 'organization'
      AND surviving_block.organization_id = ${primaryId}
      AND surviving_block.active
  `);
  await transaction.execute(sql`
    UPDATE communication_blocks SET organization_id = ${primaryId}
    WHERE target_type = 'organization' AND organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE paper_note_entries
    SET selected_organization_id = ${primaryId}, updated_at = now()
    WHERE selected_organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE paper_note_entries
    SET imported_organization_id = ${primaryId}, updated_at = now()
    WHERE imported_organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE organization_phones SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE event_attendance_history SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    DELETE FROM business_source_document_links duplicate_link
    USING business_source_document_links surviving_link
    WHERE duplicate_link.organization_id = ${duplicateId}
      AND surviving_link.organization_id = ${primaryId}
      AND surviving_link.source_document_id = duplicate_link.source_document_id
  `);
  await transaction.execute(sql`
    UPDATE business_source_document_links SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE convention_members SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId}
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
      )
  `);
  await transaction.execute(sql`
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
      AND duplicate_email.opportunity_id = duplicate_opportunity.id
  `);
  await transaction.execute(sql`
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
      updated_at = now()
  `);
  await transaction.execute(sql`
    DELETE FROM booking_opportunities duplicate_opportunity
    USING booking_opportunities surviving_opportunity
    WHERE duplicate_opportunity.organization_id = ${duplicateId}
      AND surviving_opportunity.organization_id = ${primaryId}
      AND surviving_opportunity.event_year = duplicate_opportunity.event_year
  `);
  await transaction.execute(sql`
    UPDATE booking_opportunities SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);
  await transaction.execute(sql`
    UPDATE booking_opportunity_email_state SET organization_id = ${primaryId}, updated_at = now()
    WHERE organization_id = ${duplicateId}
  `);

  const optionalTablesResult = await transaction.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN (
        'derived_crm_facts',
        'profile_research_runs',
        'lead_scout_candidates',
        'scout_alert_watches',
        'scout_alerts',
        'google_workspace_validation_mappings',
        'google_workspace_validation_review_items',
        'google_workspace_profile_files',
        'google_workspace_profile_email_threads',
        'google_workspace_profile_labels',
        'google_workspace_gmail_mutations',
        'google_workspace_gmail_thread_intents'
      )
  `);
  const optionalTables = new Set(
    (optionalTablesResult as unknown as { rows: Array<{ table_name: string }> }).rows.map(
      ({ table_name }) => table_name,
    ),
  );
  if (optionalTables.has("derived_crm_facts")) {
    await transaction.execute(sql`
      UPDATE derived_crm_facts SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("profile_research_runs")) {
    await transaction.execute(sql`
      UPDATE profile_research_runs SET profile_id = ${primaryId}, updated_at = now()
      WHERE profile_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("lead_scout_candidates")) {
    await transaction.execute(sql`
      UPDATE lead_scout_candidates SET matched_organization_id = ${primaryId}
      WHERE matched_organization_id = ${duplicateId}
    `);
    await transaction.execute(sql`
      UPDATE lead_scout_candidates SET saved_organization_id = ${primaryId}
      WHERE saved_organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("scout_alert_watches")) {
    await transaction.execute(sql`
      UPDATE scout_alert_watches SET organization_id = ${primaryId}
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("scout_alerts")) {
    await transaction.execute(sql`
      UPDATE scout_alerts SET organization_id = ${primaryId}
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_validation_mappings")) {
    await transaction.execute(sql`
      UPDATE google_workspace_validation_mappings
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_validation_review_items")) {
    await transaction.execute(sql`
      UPDATE google_workspace_validation_review_items
      SET resolved_organization_id = ${primaryId}, updated_at = now()
      WHERE resolved_organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_profile_files")) {
    await transaction.execute(sql`
      UPDATE google_workspace_profile_files
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_profile_email_threads")) {
    await transaction.execute(sql`
      UPDATE google_workspace_profile_email_threads
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_profile_labels")) {
    await transaction.execute(sql`
      DELETE FROM google_workspace_profile_labels duplicate_label
      USING google_workspace_profile_labels surviving_label
      WHERE duplicate_label.organization_id = ${duplicateId}
        AND surviving_label.organization_id = ${primaryId}
        AND surviving_label.connection_id = duplicate_label.connection_id
    `);
    await transaction.execute(sql`
      UPDATE google_workspace_profile_labels
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_gmail_mutations")) {
    await transaction.execute(sql`
      UPDATE google_workspace_gmail_mutations
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (optionalTables.has("google_workspace_gmail_thread_intents")) {
    await transaction.execute(sql`
      UPDATE google_workspace_gmail_thread_intents
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
}
