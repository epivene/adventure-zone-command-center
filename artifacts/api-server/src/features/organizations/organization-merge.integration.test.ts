/**
 * This suite deliberately uses PostgreSQL rather than PGlite. The duplicate
 * merge crosses restrictive foreign keys, partial unique indexes, and several
 * newer CRM tables that PGlite does not model exactly.
 *
 * Run with TEST_DATABASE_URL pointing at a disposable database:
 *   TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/api-server exec vitest run src/features/organizations/organization-merge.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { DrizzleOrganizationRepository } from "./organization-repository";
import { prepareOrganizationMergeReferences } from "./organization-merge-reference-preparation";

const postgresOnly = process.env.TEST_DATABASE_URL ? describe : describe.skip;

type Fixture = {
  primaryId: string;
  duplicateId: string;
  primaryLocationId: string;
  duplicateLocationId: string;
  primaryContactId: string;
  duplicateContactId: string;
  bookingId: string;
  bookingContactId: string;
  followUpId: string;
  activityId: string;
  callId: string;
  officeAccountId: string;
  officeTaskId: string;
  officeMailId: string;
  officeDraftId: string;
  leadBatchId: string;
  leadRowId: string;
  googleConnectionId: string;
  templateId: string;
  leadDraftId: string;
  primaryBlockId: string;
  duplicateBlockId: string;
  primaryBlockEventId: string;
  duplicateBlockEventId: string;
  primaryOpportunityId: string;
  duplicateOpportunityId: string;
  primarySentEmailId: string;
  primaryCurrentEmailId: string;
  duplicateSentEmailId: string;
  duplicateCancelledEmailId: string;
  duplicateCurrentEmailId: string;
  attendanceDocumentId: string;
  attendanceRowId: string;
  attendanceHistoryId: string;
  paperBatchId: string;
  paperPageId: string;
  paperEntryId: string;
  phoneId: string;
  sourceDocumentId: string;
  duplicateSourceLinkId: string;
  actLinkId: string;
  researchRunId: string;
  scoutRunId: string;
  scoutCandidateId: string;
  scoutWatchId: string;
  scoutAlertId: string;
};

const id = () => randomUUID();

function createFixture(): Fixture {
  return {
    primaryId: id(),
    duplicateId: id(),
    primaryLocationId: id(),
    duplicateLocationId: id(),
    primaryContactId: id(),
    duplicateContactId: id(),
    bookingId: id(),
    bookingContactId: id(),
    followUpId: id(),
    activityId: id(),
    callId: id(),
    officeAccountId: id(),
    officeTaskId: id(),
    officeMailId: id(),
    officeDraftId: id(),
    leadBatchId: id(),
    leadRowId: id(),
    googleConnectionId: id(),
    templateId: id(),
    leadDraftId: id(),
    primaryBlockId: id(),
    duplicateBlockId: id(),
    primaryBlockEventId: id(),
    duplicateBlockEventId: id(),
    primaryOpportunityId: id(),
    duplicateOpportunityId: id(),
    primarySentEmailId: id(),
    primaryCurrentEmailId: id(),
    duplicateSentEmailId: id(),
    duplicateCancelledEmailId: id(),
    duplicateCurrentEmailId: id(),
    attendanceDocumentId: id(),
    attendanceRowId: id(),
    attendanceHistoryId: id(),
    paperBatchId: id(),
    paperPageId: id(),
    paperEntryId: id(),
    phoneId: id(),
    sourceDocumentId: id(),
    duplicateSourceLinkId: id(),
    actLinkId: id(),
    researchRunId: id(),
    scoutRunId: id(),
    scoutCandidateId: id(),
    scoutWatchId: id(),
    scoutAlertId: id(),
  };
}

async function seedFixture(f: Fixture): Promise<void> {
  const primaryName = `Merge Survivor ${f.primaryId}`;
  const duplicateName = `Merge Duplicate ${f.duplicateId}`;
  const primaryEmail = `primary-${f.primaryId}@example.com`;
  const duplicateEmail = `duplicate-${f.duplicateId}@example.com`;
  const officeLogin = `merge-test-${f.officeAccountId}`;
  const leadFilename = `merge-${f.leadBatchId}.csv`;
  const fileSha256 = f.leadBatchId.replaceAll("-", "").padEnd(64, "b");
  const googleEmail = `merge-${f.googleConnectionId}@example.com`;
  const templateCode = `merge-test-${f.templateId}`;
  const leadIdempotencyKey = `merge-${f.leadDraftId}`;
  const primaryMessageId = `primary-msg-${f.primarySentEmailId}`;
  const duplicateMessageId = `duplicate-msg-${f.duplicateSentEmailId}`;
  const sourceFilename = `merge-source-${f.sourceDocumentId}.pdf`;
  const paperObjectKey = `merge/${f.paperPageId}`;
  const actRecordId = `merge-act-${f.actLinkId}`;
  const scoutCandidateKey = `merge-${f.scoutCandidateId}`;
  const scoutFingerprint = `merge-${f.scoutAlertId}`;

  await db.execute(sql`
    INSERT INTO organizations (id, name, place_type)
    VALUES
      (${f.primaryId}, ${primaryName}, 'other'),
      (${f.duplicateId}, ${duplicateName}, 'other')
  `);
  await db.execute(sql`
    INSERT INTO organization_locations
      (id, organization_id, label, city, region, consolidation_source_org_id)
    VALUES
      (${f.primaryLocationId}, ${f.primaryId}, 'Survivor office', 'Denver', 'CO', NULL),
      (${f.duplicateLocationId}, ${f.duplicateId}, 'Duplicate office', 'Denver', 'CO', ${f.duplicateId})
  `);
  await db.execute(sql`
    INSERT INTO contacts (id, organization_id, first_name, last_name, email, organization_location_id)
    VALUES
      (${f.primaryContactId}, NULL, 'Primary', 'Contact', ${primaryEmail}, NULL),
      (${f.duplicateContactId}, NULL, 'Duplicate', 'Contact', ${duplicateEmail}, NULL)
  `);
  await db.execute(sql`
    INSERT INTO organization_contacts
      (organization_id, contact_id, role, is_primary, active, source)
    VALUES
      (${f.primaryId}, ${f.primaryContactId}, 'owner', true, true, 'test'),
      (${f.duplicateId}, ${f.duplicateContactId}, 'owner', true, true, 'test')
  `);
  await db.execute(sql`
    UPDATE contacts
    SET organization_id = ${f.primaryId}, organization_location_id = ${f.primaryLocationId}
    WHERE id = ${f.primaryContactId}
  `);
  await db.execute(sql`
    UPDATE contacts
    SET organization_id = ${f.duplicateId}, organization_location_id = ${f.duplicateLocationId}
    WHERE id = ${f.duplicateContactId}
  `);
  await db.execute(sql`
    INSERT INTO bookings
      (id, organization_id, name, city, region, status, probability)
    VALUES
      (${f.bookingId}, ${f.duplicateId}, 'Duplicate booking', 'Denver', 'CO', 'new_lead', 'possible')
  `);
  await db.execute(sql`
    INSERT INTO booking_contacts
      (id, booking_id, contact_id, role, is_primary, source)
    VALUES
      (${f.bookingContactId}, ${f.bookingId}, ${f.duplicateContactId}, 'primary', true, 'test')
  `);
  await db.execute(sql`
    UPDATE bookings SET primary_contact_id = ${f.duplicateContactId}
    WHERE id = ${f.bookingId}
  `);
  await db.execute(sql`
    INSERT INTO follow_ups
      (id, booking_id, organization_id, contact_id, kind, due_at)
    VALUES
      (${f.followUpId}, ${f.bookingId}, ${f.duplicateId}, ${f.duplicateContactId}, 'merge test follow-up', now())
  `);
  await db.execute(sql`
    INSERT INTO activities
      (id, organization_id, contact_id, booking_id, kind, body, occurred_at, timeline_sort_at)
    VALUES
      (${f.activityId}, ${f.duplicateId}, ${f.duplicateContactId}, ${f.bookingId}, 'note', 'duplicate CRM history', now(), now())
  `);
  await db.execute(sql`
    INSERT INTO call_sessions
      (id, organization_id, contact_id, booking_id, follow_up_id, direction, method,
       disposition, started_at)
    VALUES
      (${f.callId}, ${f.duplicateId}, ${f.duplicateContactId}, ${f.bookingId}, ${f.followUpId},
       'outgoing', 'standard_call', 'spoke_with_contact', now())
  `);

  await db.execute(sql`
    INSERT INTO office_accounts
      (id, login_name, display_name, password_hash, password_salt)
    VALUES
      (${f.officeAccountId}, ${officeLogin}, 'Merge test coordinator', 'hash', 'salt')
  `);
  await db.execute(sql`
    INSERT INTO office_tasks
      (id, office_account_id, task_type, title, organization_id, contact_id, owner_sort_order)
    VALUES
      (${f.officeTaskId}, ${f.officeAccountId}, 'other', 'Merge test task', ${f.duplicateId}, ${f.duplicateContactId}, 0)
  `);
  await db.execute(sql`
    INSERT INTO office_mail_activity
      (id, office_account_id, task_id, organization_id, contact_id, note)
    VALUES
      (${f.officeMailId}, ${f.officeAccountId}, ${f.officeTaskId}, ${f.duplicateId}, ${f.duplicateContactId}, 'mailed')
  `);
  await db.execute(sql`
    INSERT INTO office_email_drafts
      (id, office_account_id, organization_id, contact_id, recipient_email, subject, body, state)
    VALUES
      (${f.officeDraftId}, ${f.officeAccountId}, ${f.duplicateId}, ${f.duplicateContactId},
       ${duplicateEmail}, 'Merge test email', 'Preserve this draft', 'draft')
  `);

  await db.execute(sql`
    INSERT INTO lead_import_batches
      (id, original_filename, file_sha256, status, row_count, imported_by)
    VALUES
      (${f.leadBatchId}, ${leadFilename}, ${fileSha256}, 'review', 1, 'merge-test')
  `);
  await db.execute(sql`
    INSERT INTO lead_import_rows
      (id, batch_id, sheet_name, source_row_number, source_fingerprint, original_values,
       selected_organization_id, selected_contact_id)
    VALUES
      (${f.leadRowId}, ${f.leadBatchId}, 'Sheet1', 1, repeat('b', 64), '{}'::jsonb,
       ${f.duplicateId}, ${f.duplicateContactId})
  `);
  await db.execute(sql`
    INSERT INTO google_workspace_connections
      (id, account_email, role, status, encrypted_refresh_token)
    VALUES
      (${f.googleConnectionId}, ${googleEmail}, 'workspace',
       'disconnected', '{}'::jsonb)
  `);
  await db.execute(sql`
    INSERT INTO communication_templates
      (id, code, name, category, body_template, state, access_scope)
    VALUES
      (${f.templateId}, ${templateCode}, 'Merge test template', 'general', 'Hello', 'draft', 'owner')
  `);
  await db.execute(sql`
    INSERT INTO lead_gmail_draft_links
      (id, row_id, organization_id, contact_id, google_connection_id, communication_template_id,
       template_version, recipient_email, subject, body, state, idempotency_key, actor_id, last_attempt_at)
    VALUES
      (${f.leadDraftId}, ${f.leadRowId}, ${f.duplicateId}, ${f.duplicateContactId}, ${f.googleConnectionId},
       ${f.templateId}, 'v1', ${duplicateEmail}, 'Merge lead', 'Preserve lead draft',
       'prepared', ${leadIdempotencyKey}, 'merge-test', now())
  `);
  await db.execute(sql`
    INSERT INTO communication_blocks
      (id, target_type, organization_id, reason, active, created_by)
    VALUES
      (${f.primaryBlockId}, 'organization', ${f.primaryId}, 'survivor block', true, 'merge-test'),
      (${f.duplicateBlockId}, 'organization', ${f.duplicateId}, 'duplicate block', true, 'merge-test')
  `);
  await db.execute(sql`
    INSERT INTO communication_block_events (id, block_id, action, actor_id, reason)
    VALUES
      (${f.primaryBlockEventId}, ${f.primaryBlockId}, 'created', 'merge-test', 'survivor event'),
      (${f.duplicateBlockEventId}, ${f.duplicateBlockId}, 'created', 'merge-test', 'duplicate event')
  `);

  await db.execute(sql`
    INSERT INTO booking_opportunities
      (id, organization_id, event_year, contact_id, status, priority)
    VALUES
      (${f.primaryOpportunityId}, ${f.primaryId}, 2039, ${f.primaryContactId}, 'contacted', 'normal'),
      (${f.duplicateOpportunityId}, ${f.duplicateId}, 2039, ${f.duplicateContactId}, 'follow_up', 'high')
  `);
  await db.execute(sql`
    INSERT INTO booking_opportunity_email_state
      (id, opportunity_id, organization_id, contact_id, event_year, purpose, state,
       recipient_email, subject, body, gmail_message_id)
    VALUES
      (${f.primarySentEmailId}, ${f.primaryOpportunityId}, ${f.primaryId}, ${f.primaryContactId}, 2039,
       'new_outreach', 'sent', ${primaryEmail}, 'sent primary', 'keep primary sent', ${primaryMessageId}),
      (${f.primaryCurrentEmailId}, ${f.primaryOpportunityId}, ${f.primaryId}, ${f.primaryContactId}, 2039,
       'reply', 'draft', ${primaryEmail}, 'current primary', 'keep primary current', NULL),
      (${f.duplicateSentEmailId}, ${f.duplicateOpportunityId}, ${f.duplicateId}, ${f.duplicateContactId}, 2039,
       'new_outreach', 'sent', ${duplicateEmail}, 'sent duplicate', 'keep duplicate sent', ${duplicateMessageId}),
      (${f.duplicateCancelledEmailId}, ${f.duplicateOpportunityId}, ${f.duplicateId}, ${f.duplicateContactId}, 2039,
       'follow_up', 'cancelled', ${duplicateEmail}, 'cancelled duplicate', 'keep duplicate cancelled', NULL),
      (${f.duplicateCurrentEmailId}, ${f.duplicateOpportunityId}, ${f.duplicateId}, ${f.duplicateContactId}, 2039,
       'reply', 'draft', ${duplicateEmail}, 'current duplicate', 'current is cancelled then retained', NULL)
  `);

  await db.execute(sql`
    INSERT INTO business_source_documents
      (id, original_filename, display_title, source_category)
    VALUES
      (${f.sourceDocumentId}, ${sourceFilename}, 'Merge source', 'other')
  `);
  await db.execute(sql`
    INSERT INTO business_source_document_links
      (source_document_id, organization_id, link_kind, created_by)
    VALUES
      (${f.sourceDocumentId}, ${f.primaryId}, 'profile', 'merge-test')
  `);
  await db.execute(sql`
    INSERT INTO business_source_document_links
      (id, source_document_id, organization_id, link_kind, created_by)
    VALUES
      (${f.duplicateSourceLinkId}, ${f.sourceDocumentId}, ${f.duplicateId}, 'profile', 'merge-test')
  `);

  await db.execute(sql`
    INSERT INTO attendance_import_rows
      (id, source_document_id, source_row_number, month, original_event_name, original_location,
       normalized_event_name, normalized_location, match_state)
    VALUES
      (${f.attendanceRowId}, ${f.sourceDocumentId}, 1, 'June', 'Merge event', 'Denver',
       'merge event', 'denver', 'approved')
  `);
  await db.execute(sql`
    INSERT INTO event_attendance_history
      (id, organization_id, organization_location_id, source_import_row_id, year, month, status,
       original_event_name, original_location, approved_by, approved_at)
    VALUES
      (${f.attendanceHistoryId}, ${f.duplicateId}, ${f.duplicateLocationId}, ${f.attendanceRowId},
       2039, 'June', 'attended', 'Merge event', 'Denver', 'merge-test', now())
  `);
  await db.execute(sql`
    INSERT INTO paper_note_batches (id, name)
    VALUES (${f.paperBatchId}, 'Merge paper notes')
  `);
  await db.execute(sql`
    INSERT INTO paper_note_pages
      (id, batch_id, sort_order, original_filename, mime_type, original_object_key)
    VALUES
      (${f.paperPageId}, ${f.paperBatchId}, 0, 'merge.png', 'image/png', ${paperObjectKey})
  `);
  await db.execute(sql`
    INSERT INTO paper_note_entries
      (id, batch_id, page_id, source_order, selected_organization_id, imported_organization_id)
    VALUES
      (${f.paperEntryId}, ${f.paperBatchId}, ${f.paperPageId}, 0, ${f.duplicateId}, ${f.duplicateId})
  `);
  await db.execute(sql`
    INSERT INTO organization_phones
      (id, organization_id, organization_location_id, number, normalized_number, type, status,
       "primary", source, source_paper_note_entry_id)
    VALUES
      (${f.phoneId}, ${f.duplicateId}, ${f.duplicateLocationId}, '303-555-0199', '3035550199',
       'office', 'active', true, 'paper_note', ${f.paperEntryId})
  `);
  await db.execute(sql`
    INSERT INTO act_external_links
      (id, entity_type, source_entity_type, entity_id, act_record_id, is_primary, sync_mode)
    VALUES
      (${f.actLinkId}, 'organization', 'company', ${f.duplicateId}, ${actRecordId}, true, 'pull_only')
  `);
  await db.execute(sql`
    INSERT INTO profile_research_runs
      (id, profile_id, mode, status, context_snapshot)
    VALUES
      (${f.researchRunId}, ${f.duplicateId}, 'quick', 'complete', '{}'::jsonb)
  `);
  await db.execute(sql`
    INSERT INTO lead_scout_runs
      (id, actor_id, original_question, status, stage, progress)
    VALUES
      (${f.scoutRunId}, 'merge-test', 'merge history', 'complete', 'complete', '{}'::jsonb)
  `);
  await db.execute(sql`
    INSERT INTO lead_scout_candidates
      (id, run_id, name, crm_match_status, matched_organization_id, review_status,
       saved_organization_id, candidate_key)
    VALUES
      (${f.scoutCandidateId}, ${f.scoutRunId}, 'Merge scout history', 'existing',
       ${f.duplicateId}, 'saved', ${f.duplicateId}, ${scoutCandidateKey})
  `);
  await db.execute(sql`
    INSERT INTO scout_alert_watches
      (id, candidate_id, actor_id, organization_id, status)
    VALUES
      (${f.scoutWatchId}, ${f.scoutCandidateId}, 'merge-test', ${f.duplicateId}, 'active')
  `);
  await db.execute(sql`
    INSERT INTO scout_alerts
      (id, watch_id, organization_id, kind, severity, title, body, fingerprint)
    VALUES
      (${f.scoutAlertId}, ${f.scoutWatchId}, ${f.duplicateId}, 'contact_changed', 'info',
       'Merge alert', 'Preserve scout history', ${scoutFingerprint})
  `);

}

async function cleanupFixture(f: Fixture): Promise<void> {
  await db.execute(sql`DELETE FROM scout_alerts WHERE id = ${f.scoutAlertId}`);
  await db.execute(sql`DELETE FROM scout_alert_watches WHERE id = ${f.scoutWatchId}`);
  await db.execute(sql`DELETE FROM lead_scout_candidates WHERE id = ${f.scoutCandidateId}`);
  await db.execute(sql`DELETE FROM lead_scout_runs WHERE id = ${f.scoutRunId}`);
  await db.execute(sql`DELETE FROM profile_research_runs WHERE id = ${f.researchRunId}`);
  await db.execute(sql`DELETE FROM act_external_links WHERE id = ${f.actLinkId}`);
  await db.execute(sql`DELETE FROM organization_phones WHERE id = ${f.phoneId}`);
  await db.execute(sql`DELETE FROM paper_note_entries WHERE id = ${f.paperEntryId}`);
  await db.execute(sql`DELETE FROM paper_note_pages WHERE id = ${f.paperPageId}`);
  await db.execute(sql`DELETE FROM paper_note_batches WHERE id = ${f.paperBatchId}`);
  await db.execute(sql`DELETE FROM event_attendance_history WHERE id = ${f.attendanceHistoryId}`);
  await db.execute(sql`DELETE FROM attendance_import_rows WHERE id = ${f.attendanceRowId}`);
  await db.execute(sql`DELETE FROM business_source_document_links WHERE source_document_id = ${f.sourceDocumentId}`);
  await db.execute(sql`DELETE FROM business_source_documents WHERE id = ${f.sourceDocumentId}`);
  await db.execute(sql`DELETE FROM booking_opportunity_email_state WHERE opportunity_id IN (${f.primaryOpportunityId}, ${f.duplicateOpportunityId})`);
  await db.execute(sql`DELETE FROM booking_opportunities WHERE id IN (${f.primaryOpportunityId}, ${f.duplicateOpportunityId})`);
  await db.execute(sql`DELETE FROM communication_block_events WHERE block_id IN (${f.primaryBlockId}, ${f.duplicateBlockId})`);
  await db.execute(sql`DELETE FROM communication_blocks WHERE id IN (${f.primaryBlockId}, ${f.duplicateBlockId})`);
  await db.execute(sql`DELETE FROM lead_gmail_draft_links WHERE id = ${f.leadDraftId}`);
  await db.execute(sql`DELETE FROM communication_templates WHERE id = ${f.templateId}`);
  await db.execute(sql`DELETE FROM google_workspace_connections WHERE id = ${f.googleConnectionId}`);
  await db.execute(sql`DELETE FROM lead_import_rows WHERE id = ${f.leadRowId}`);
  await db.execute(sql`DELETE FROM lead_import_batches WHERE id = ${f.leadBatchId}`);
  await db.execute(sql`DELETE FROM office_email_drafts WHERE id = ${f.officeDraftId}`);
  await db.execute(sql`DELETE FROM office_mail_activity WHERE id = ${f.officeMailId}`);
  await db.execute(sql`DELETE FROM office_tasks WHERE id = ${f.officeTaskId}`);
  await db.execute(sql`DELETE FROM office_accounts WHERE id = ${f.officeAccountId}`);
  await db.execute(sql`DELETE FROM call_sessions WHERE id = ${f.callId}`);
  await db.execute(sql`DELETE FROM activities WHERE id = ${f.activityId}`);
  await db.execute(sql`DELETE FROM follow_ups WHERE id = ${f.followUpId}`);
  await db.execute(sql`UPDATE bookings SET primary_contact_id = NULL WHERE id = ${f.bookingId}`);
  await db.execute(sql`DELETE FROM booking_contacts WHERE id = ${f.bookingContactId}`);
  await db.execute(sql`DELETE FROM bookings WHERE id = ${f.bookingId}`);
  await db.execute(sql`
    UPDATE contacts
    SET organization_id = NULL, organization_location_id = NULL
    WHERE id IN (${f.primaryContactId}, ${f.duplicateContactId})
  `);
  await db.execute(sql`DELETE FROM organization_contacts WHERE organization_id IN (${f.primaryId}, ${f.duplicateId})`);
  await db.execute(sql`DELETE FROM contacts WHERE id IN (${f.primaryContactId}, ${f.duplicateContactId})`);
  await db.execute(sql`DELETE FROM organization_locations WHERE id IN (${f.primaryLocationId}, ${f.duplicateLocationId})`);
  await db.execute(sql`DELETE FROM organizations WHERE id IN (${f.primaryId}, ${f.duplicateId})`);
}

async function organizationReferenceCounts(f: Fixture) {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM contacts WHERE organization_id = ${f.duplicateId}) AS contacts,
      (SELECT count(*) FROM organization_locations WHERE organization_id = ${f.duplicateId}) AS locations,
      (SELECT count(*) FROM bookings WHERE organization_id = ${f.duplicateId}) AS bookings,
      (SELECT count(*) FROM activities WHERE organization_id = ${f.duplicateId}) AS activities,
      (SELECT count(*) FROM call_sessions WHERE organization_id = ${f.duplicateId}) AS calls,
      (SELECT count(*) FROM follow_ups WHERE organization_id = ${f.duplicateId}) AS follow_ups,
      (SELECT count(*) FROM office_tasks WHERE organization_id = ${f.duplicateId}) AS office_tasks,
      (SELECT count(*) FROM office_mail_activity WHERE organization_id = ${f.duplicateId}) AS office_mail,
      (SELECT count(*) FROM office_email_drafts WHERE organization_id = ${f.duplicateId}) AS office_drafts,
      (SELECT count(*) FROM lead_import_rows WHERE selected_organization_id = ${f.duplicateId}) AS lead_rows,
      (SELECT count(*) FROM lead_gmail_draft_links WHERE organization_id = ${f.duplicateId}) AS lead_drafts,
      (SELECT count(*) FROM communication_blocks WHERE organization_id = ${f.duplicateId}) AS blocks,
      (SELECT count(*) FROM booking_opportunities WHERE organization_id = ${f.duplicateId}) AS opportunities,
      (SELECT count(*) FROM event_attendance_history WHERE organization_id = ${f.duplicateId}) AS attendance,
      (SELECT count(*) FROM paper_note_entries WHERE selected_organization_id = ${f.duplicateId} OR imported_organization_id = ${f.duplicateId}) AS paper_notes,
      (SELECT count(*) FROM organization_phones WHERE organization_id = ${f.duplicateId}) AS phones,
      (SELECT count(*) FROM business_source_document_links WHERE organization_id = ${f.duplicateId}) AS source_links,
      (SELECT count(*) FROM act_external_links WHERE entity_id = ${f.duplicateId}) AS act_links,
      (SELECT count(*) FROM profile_research_runs WHERE profile_id = ${f.duplicateId}) AS research,
      (SELECT count(*) FROM lead_scout_candidates WHERE matched_organization_id = ${f.duplicateId} OR saved_organization_id = ${f.duplicateId}) AS scout_candidates,
      (SELECT count(*) FROM scout_alert_watches WHERE organization_id = ${f.duplicateId}) AS scout_watches,
      (SELECT count(*) FROM scout_alerts WHERE organization_id = ${f.duplicateId}) AS scout_alerts
  `);
  return (result as unknown as { rows: Array<Record<string, string>> }).rows[0]!;
}

postgresOnly("organization duplicate merge PostgreSQL integration", () => {
  it("rolls back every prepared reference, then retries and preserves all CRM history", async () => {
    const f = createFixture();
    const repository = new DrizzleOrganizationRepository(db);

    try {
      await seedFixture(f);
      await expect(
        db.transaction(async (transaction) => {
          await prepareOrganizationMergeReferences(transaction, f.primaryId, [f.duplicateId]);
          await repository.mergeOrganizations(f.primaryId, [f.duplicateId], transaction);
          throw new Error("forced late merge failure");
        }),
      ).rejects.toThrow("forced late merge failure");

      expect(await organizationReferenceCounts(f)).toEqual({
        contacts: "1",
        locations: "1",
        bookings: "1",
        activities: "1",
        calls: "1",
        follow_ups: "1",
        office_tasks: "1",
        office_mail: "1",
        office_drafts: "1",
        lead_rows: "1",
        lead_drafts: "1",
        blocks: "1",
        opportunities: "1",
        attendance: "1",
        paper_notes: "1",
        phones: "1",
        source_links: "1",
        act_links: "1",
        research: "1",
        scout_candidates: "1",
        scout_watches: "1",
        scout_alerts: "1",
      });

      await db.transaction(async (transaction) => {
        await prepareOrganizationMergeReferences(transaction, f.primaryId, [f.duplicateId]);
        await repository.mergeOrganizations(f.primaryId, [f.duplicateId], transaction);
      });

      const duplicate = await db.execute(sql`
        SELECT count(*) AS count FROM organizations WHERE id = ${f.duplicateId}
      `);
      expect((duplicate as unknown as { rows: Array<{ count: string }> }).rows[0]!.count).toBe("0");
      expect(await organizationReferenceCounts(f)).toEqual({
        contacts: "0",
        locations: "0",
        bookings: "0",
        activities: "0",
        calls: "0",
        follow_ups: "0",
        office_tasks: "0",
        office_mail: "0",
        office_drafts: "0",
        lead_rows: "0",
        lead_drafts: "0",
        blocks: "0",
        opportunities: "0",
        attendance: "0",
        paper_notes: "0",
        phones: "0",
        source_links: "0",
        act_links: "0",
        research: "0",
        scout_candidates: "0",
        scout_watches: "0",
        scout_alerts: "0",
      });

      const moved = await db.execute(sql`
        SELECT
          (SELECT count(*) FROM contacts WHERE organization_id = ${f.primaryId}) AS contacts,
          (SELECT count(*) FROM organization_locations WHERE organization_id = ${f.primaryId}) AS locations,
          (SELECT count(*) FROM bookings WHERE organization_id = ${f.primaryId}) AS bookings,
          (SELECT count(*) FROM activities WHERE organization_id = ${f.primaryId}) AS activities,
          (SELECT count(*) FROM call_sessions WHERE organization_id = ${f.primaryId}) AS calls,
          (SELECT count(*) FROM follow_ups WHERE organization_id = ${f.primaryId}) AS follow_ups,
          (SELECT count(*) FROM office_tasks WHERE organization_id = ${f.primaryId}) AS office_tasks,
          (SELECT count(*) FROM office_mail_activity WHERE organization_id = ${f.primaryId}) AS office_mail,
          (SELECT count(*) FROM office_email_drafts WHERE organization_id = ${f.primaryId}) AS office_drafts,
          (SELECT count(*) FROM lead_import_rows WHERE selected_organization_id = ${f.primaryId}) AS lead_rows,
          (SELECT count(*) FROM lead_gmail_draft_links WHERE organization_id = ${f.primaryId}) AS lead_drafts,
          (SELECT count(*) FROM communication_blocks WHERE organization_id = ${f.primaryId}) AS blocks,
          (SELECT count(*) FROM booking_opportunities WHERE organization_id = ${f.primaryId}) AS opportunities,
          (SELECT count(*) FROM event_attendance_history WHERE organization_id = ${f.primaryId}) AS attendance,
          (SELECT count(*) FROM paper_note_entries WHERE selected_organization_id = ${f.primaryId} OR imported_organization_id = ${f.primaryId}) AS paper_notes,
          (SELECT count(*) FROM organization_phones WHERE organization_id = ${f.primaryId}) AS phones,
          (SELECT count(*) FROM business_source_document_links WHERE organization_id = ${f.primaryId}) AS source_links,
          (SELECT count(*) FROM act_external_links WHERE entity_id = ${f.primaryId}) AS act_links,
          (SELECT count(*) FROM profile_research_runs WHERE profile_id = ${f.primaryId}) AS research,
          (SELECT count(*) FROM lead_scout_candidates WHERE matched_organization_id = ${f.primaryId} OR saved_organization_id = ${f.primaryId}) AS scout_candidates,
          (SELECT count(*) FROM scout_alert_watches WHERE organization_id = ${f.primaryId}) AS scout_watches,
          (SELECT count(*) FROM scout_alerts WHERE organization_id = ${f.primaryId}) AS scout_alerts
      `);
      expect((moved as unknown as { rows: Array<Record<string, string>> }).rows[0]).toEqual({
        contacts: "2",
        locations: "2",
        bookings: "1",
        activities: "1",
        calls: "1",
        follow_ups: "1",
        office_tasks: "1",
        office_mail: "1",
        office_drafts: "1",
        lead_rows: "1",
        lead_drafts: "1",
        blocks: "1",
        opportunities: "1",
        attendance: "1",
        paper_notes: "1",
        phones: "1",
        source_links: "1",
        act_links: "1",
        research: "1",
        scout_candidates: "1",
        scout_watches: "1",
        scout_alerts: "1",
      });

      const emailStates = await db.execute(sql`
        SELECT state, count(*)::text AS count
        FROM booking_opportunity_email_state
        WHERE opportunity_id = ${f.primaryOpportunityId}
        GROUP BY state
        ORDER BY state
      `);
      expect((emailStates as unknown as { rows: Array<{ state: string; count: string }> }).rows).toEqual([
        { state: "cancelled", count: "2" },
        { state: "draft", count: "1" },
        { state: "sent", count: "2" },
      ]);
      const currentStates = await db.execute(sql`
        SELECT count(*)::text AS count
        FROM booking_opportunity_email_state
        WHERE opportunity_id = ${f.primaryOpportunityId}
          AND state IN ('draft', 'scheduled', 'failed')
      `);
      expect((currentStates as unknown as { rows: Array<{ count: string }> }).rows[0]!.count).toBe("1");
    } finally {
      await cleanupFixture(f);
    }
  });
});