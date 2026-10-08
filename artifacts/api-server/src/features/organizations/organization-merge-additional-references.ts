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
  const editionTable = await transaction.execute(sql`SELECT to_regclass(current_schema() || '.festival_editions') IS NOT NULL AS present`);
  if (editionTable.rows[0]?.present) {
    const overlapping = await transaction.execute(sql`
      SELECT incoming.year FROM festival_editions incoming
      JOIN festival_editions surviving ON surviving.organization_id = ${primaryId} AND surviving.year = incoming.year
      WHERE incoming.organization_id = ${duplicateId} LIMIT 1
    `);
    if (overlapping.rows.length) throw new Error("Both profiles have details for the same festival year. Reconcile those details before merging; neither record has been deleted.");
    await transaction.execute(sql`UPDATE festival_editions SET organization_id = ${primaryId}, updated_at = now() WHERE organization_id = ${duplicateId}`);
  }
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
  // Remove destination-equivalent phone rows before re-parenting. The phone
  // table enforces uniqueness per organization/number/extension, so a plain
  // UPDATE aborts the entire merge when both profiles already carry the same
  // normalized phone number.
  await transaction.execute(sql`
    DELETE FROM organization_phones duplicate_phone
    USING organization_phones surviving_phone
    WHERE duplicate_phone.organization_id = ${duplicateId}
      AND surviving_phone.organization_id = ${primaryId}
      AND duplicate_phone.organization_location_id IS NOT DISTINCT FROM surviving_phone.organization_location_id
      AND duplicate_phone.normalized_number = surviving_phone.normalized_number
      AND COALESCE(duplicate_phone.normalized_extension, '') = COALESCE(surviving_phone.normalized_extension, '')
      AND duplicate_phone.normalized_number IS NOT NULL
  `);
  // A profile may have only one active primary general phone. Preserve the
  // survivor's designation and retain any distinct incoming phone as secondary.
  await transaction.execute(sql`
    UPDATE organization_phones incoming_phone
    SET "primary" = false, updated_at = now()
    WHERE incoming_phone.organization_id = ${duplicateId}
      AND incoming_phone.organization_location_id IS NULL
      AND incoming_phone."primary"
      AND incoming_phone.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM organization_phones surviving_phone
        WHERE surviving_phone.organization_id = ${primaryId}
          AND surviving_phone.organization_location_id IS NULL
          AND surviving_phone."primary"
          AND surviving_phone.status = 'active'
      )
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
  // A document link must always point to exactly one target. Its organization
  // FK uses ON DELETE SET NULL, but the table check rejects a targetless row,
  // so move profile links before deleting the duplicate organization. Remove
  // an equivalent survivor link first to satisfy the per-document unique index.
  await transaction.execute(sql`
    DELETE FROM business_document_links duplicate_link
    USING business_document_links surviving_link
    WHERE duplicate_link.organization_id = ${duplicateId}
      AND duplicate_link.target_kind = 'profile'
      AND surviving_link.organization_id = ${primaryId}
      AND surviving_link.target_kind = 'profile'
      AND surviving_link.document_id = duplicate_link.document_id
  `);
  await transaction.execute(sql`
    UPDATE business_document_links
    SET organization_id = ${primaryId}
    WHERE organization_id = ${duplicateId}
      AND target_kind = 'profile'
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
        'directory_import_records',
        'google_workspace_profile_labels',
        'google_workspace_gmail_mutations',
        'google_workspace_gmail_thread_intents',
        'event_date_facts',
        'event_date_coverage_items'
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
  if (optionalTables.has("directory_import_records")) {
    await transaction.execute(sql`
      UPDATE directory_import_records
      SET organization_id = ${primaryId}
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
  await reparentEventDateCoverageReferences(transaction, primaryId, duplicateId, {
    facts: optionalTables.has("event_date_facts"),
    items: optionalTables.has("event_date_coverage_items"),
  });
}

export async function reparentEventDateCoverageReferences(
  transaction: Pick<OrganizationMergeTransaction, "execute">,
  primaryId: string,
  duplicateId: string,
  tables: { facts: boolean; items: boolean },
): Promise<void> {
  if (tables.facts) {
    // Preserve both histories. A duplicate active fact cannot remain active when
    // the surviving profile already has one, so retain it as an explicit review
    // record instead of allowing the organization cascade to erase it.
    await transaction.execute(sql`
      UPDATE event_date_facts duplicate_fact
      SET active = false,
          status = 'needs_review',
          rationale = duplicate_fact.rationale || E'\nNeeds review after organization merge: the surviving profile already had an active event-date fact.',
          updated_at = now()
      WHERE duplicate_fact.organization_id = ${duplicateId}
        AND duplicate_fact.active
        AND EXISTS (
          SELECT 1 FROM event_date_facts surviving_fact
          WHERE surviving_fact.organization_id = ${primaryId}
            AND surviving_fact.active
        )
    `);
    await transaction.execute(sql`
      UPDATE event_date_facts
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
  if (tables.items) {
    // A run can contain both profiles. Fold the duplicate item's operational
    // history into the surviving row before removing the uniqueness conflict.
    await transaction.execute(sql`
      UPDATE event_date_coverage_items surviving_item
      SET attempts = GREATEST(surviving_item.attempts, duplicate_item.attempts),
          error_detail = concat_ws(E'\n', surviving_item.error_detail,
            'Merged duplicate profile item (' || duplicate_item.id || '): ' ||
            coalesce(duplicate_item.error_detail, duplicate_item.status)),
          started_at = LEAST(surviving_item.started_at, duplicate_item.started_at),
          completed_at = GREATEST(surviving_item.completed_at, duplicate_item.completed_at),
          updated_at = now()
      FROM event_date_coverage_items duplicate_item
      WHERE duplicate_item.organization_id = ${duplicateId}
        AND surviving_item.organization_id = ${primaryId}
        AND surviving_item.run_id = duplicate_item.run_id
    `);
    await transaction.execute(sql`
      DELETE FROM event_date_coverage_items duplicate_item
      USING event_date_coverage_items surviving_item
      WHERE duplicate_item.organization_id = ${duplicateId}
        AND surviving_item.organization_id = ${primaryId}
        AND surviving_item.run_id = duplicate_item.run_id
    `);
    await transaction.execute(sql`
      UPDATE event_date_coverage_items
      SET organization_id = ${primaryId}, updated_at = now()
      WHERE organization_id = ${duplicateId}
    `);
  }
}
