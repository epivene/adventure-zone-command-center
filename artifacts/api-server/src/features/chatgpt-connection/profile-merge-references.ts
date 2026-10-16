import type { SqlQuery } from "./contracts";

// These tables already have conflict-aware handling in the legacy merge flow.
export const legacyMergeTables = new Set([
  // Immutable audit evidence retains the original IDs; it is not a live profile link.
  "audit_entries",
  "organizations",
  "organization_contacts",
  "organization_locations",
  "contacts",
  "bookings",
  "follow_ups",
  "activities",
  "activity_associations",
  "call_sessions",
  "act_external_links",
  "act_migration_records",
  "ai_booking_suggestions",
  "event_family_members",
  "office_tasks",
  "office_mail_activity",
  "office_email_drafts",
  "lead_import_rows",
  "lead_gmail_draft_links",
  "communication_blocks",
  "paper_note_entries",
  "organization_phones",
  "event_attendance_history",
  "business_source_document_links",
  "business_document_links",
  "convention_members",
  "booking_opportunities",
  "booking_opportunity_email_state",
  "derived_crm_facts",
  "profile_research_runs",
  "lead_scout_candidates",
  "scout_alert_watches",
  "scout_alerts",
  "google_workspace_validation_mappings",
  "google_workspace_validation_review_items",
  "google_workspace_profile_files",
  "google_workspace_profile_email_threads",
  "directory_import_records",
  "google_workspace_profile_labels",
  "google_workspace_gmail_mutations",
  "google_workspace_gmail_thread_intents",
  "event_date_facts",
  "event_date_coverage_items",
  "chatgpt_lead_identities",
  "chatgpt_external_drafts",
]);
// Preserve newer references without rewriting signed documents, amounts or source text.
// A uniqueness/consistency conflict aborts the whole operation; no rows are discarded.
export const extraMergeReferences: Record<string, string> = {
  email_thread_attention: "profile_id",
  google_workspace_historical_gmail_outcomes: "organization_id",
  booking_work_activities: "profile_id",
  contract_agreements: "organization_id",
  invoices: "organization_id",
  early_bird_promo_enrollments: "organization_id",
  marketing_audience_members: "organization_id",
  marketing_campaign_recipients: "organization_id",
  design_projects: "linked_organization_id",
  design_assets: "organization_id",
  design_certificates: "organization_id",
  website_inquiries: "converted_organization_id",
  boss_convention_submissions: "applied_organization_id",
  attendance_import_rows: "matched_organization_id",
  assistant_workspace_rules: "organization_id",
  assistant_profile_task_items: "profile_id",
  assistant_profile_task_evidence: "profile_id",
  assistant_profile_task_change_evidence: "profile_id",
};
// These are source identities, not live profile links. Keeping the retired ID
// lets the backup worker mark its source removed without overwriting the
// survivor's separate backup files, job generations, leases, or run history.
export const retainedMergeReferences: Record<string, string> = {
  google_drive_backup_jobs: "entity_id",
  google_drive_backup_mappings: "entity_id",
};
export async function moveExtraMergeReferences(
  tx: SqlQuery,
  primaryId: string,
  duplicateIds: string[],
  tables: string[],
) {
  for (const table of tables) {
    const column = extraMergeReferences[table];
    if (column)
      await tx.query(
        `UPDATE "${table}" SET "${column}"=$1${
          // Attention edits use revision checks. Invalidate old previews so they
          // cannot restore a deleted profile ID after this merge commits.
          table === "email_thread_attention"
            ? ", revision=gen_random_uuid(), updated_at=now()"
            : ""
        } WHERE "${column}"=ANY($2::uuid[])`,
        [primaryId, duplicateIds],
      );
  }
}
