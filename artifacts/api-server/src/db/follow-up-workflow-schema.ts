import type { WorkflowSql } from "../features/follow-ups/workflow-types";

// Additive only: existing records and reminder history remain intact.
// Each statement is retryable if a deployment stops during schema preparation.
export async function ensureFollowUpWorkflowSchema(db: WorkflowSql) {
  await db.query(
    "ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS opportunity_id uuid REFERENCES booking_opportunities(id) ON DELETE SET NULL",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS follow_ups_open_opportunity_idx ON follow_ups(opportunity_id) WHERE completed_at IS NULL",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS follow_up_workflow_settings(id boolean PRIMARY KEY DEFAULT true CHECK(id=true),activated_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query(
    "INSERT INTO follow_up_workflow_settings(id) VALUES(true) ON CONFLICT DO NOTHING",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS activities_follow_up_send_note_idx ON activities(organization_id,subject) WHERE deleted_at IS NULL AND subject LIKE 'Sent email: %'",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS activities_follow_up_decision_idx ON activities(subject,occurred_at DESC) WHERE deleted_at IS NULL AND status='no_further_action'",
  );
}
