type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function ensureOfficeCoordinatorSchema(client: Client): Promise<boolean> {
  await client.query("SET lock_timeout = '5s'");
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS office_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        login_name text NOT NULL,
        display_name text NOT NULL,
        role text NOT NULL DEFAULT 'office_coordinator' CHECK (role = 'office_coordinator'),
        password_hash text NOT NULL,
        password_salt text NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        session_version bigint NOT NULL DEFAULT 1 CHECK (session_version >= 1),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS office_accounts_login_name_lower_unique
        ON office_accounts (lower(login_name));

      CREATE TABLE IF NOT EXISTS office_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        task_type text NOT NULL CHECK (task_type IN ('contact_verification','mail_brochure','follow_up_prep','research_update','draft_email','other')),
        title text NOT NULL,
        instructions text,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','waiting','done','cancelled')),
        needs_help boolean NOT NULL DEFAULT false,
        coordinator_note text,
        owner_sort_order bigint NOT NULL,
        due_at timestamptz,
        created_by text NOT NULL DEFAULT 'owner' CHECK (created_by IN ('owner','system')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS office_tasks_account_status_order_idx
        ON office_tasks (office_account_id, status, owner_sort_order, id);
      CREATE INDEX IF NOT EXISTS office_tasks_needs_help_idx
        ON office_tasks (office_account_id, needs_help, updated_at DESC);

      CREATE TABLE IF NOT EXISTS office_mail_activity (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        task_id uuid REFERENCES office_tasks(id) ON DELETE SET NULL,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        recipient_name text,
        address_1_snapshot text,
        address_2_snapshot text,
        city_snapshot text,
        region_snapshot text,
        postal_code_snapshot text,
        prepared_at timestamptz,
        mailed_at timestamptz,
        note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS office_mail_activity_task_unique
        ON office_mail_activity (task_id) WHERE task_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS office_mail_activity_profile_mailed_idx
        ON office_mail_activity (organization_id, mailed_at DESC);
      CREATE INDEX IF NOT EXISTS office_mail_activity_account_created_idx
        ON office_mail_activity (office_account_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS office_email_drafts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
        communication_template_id uuid,
        recipient_email text NOT NULL,
        subject text NOT NULL,
        body text NOT NULL,
        body_format text NOT NULL DEFAULT 'plain_text',
        design_project_id uuid,
        design_version_id uuid,
        coordinator_note text,
        state text NOT NULL DEFAULT 'draft',
        submitted_at timestamptz,
        owner_return_note text,
        sent_at timestamptz,
        sent_message_id text,
        scheduled_for timestamptz,
        business_time_zone text,
        gmail_draft_id text,
        gmail_message_id text,
        gmail_thread_id text,
        send_request_key text,
        schedule_request_key text,
        dispatch_lease_owner text,
        dispatch_lease_expires_at timestamptz,
        dispatch_attempt_count integer NOT NULL DEFAULT 0,
        last_attempt_at timestamptz,
        next_attempt_at timestamptz,
        last_failure_code text,
        last_failure_message text,
        last_send_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE office_email_drafts
        ADD COLUMN IF NOT EXISTS communication_template_id uuid,
        ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain_text',
        ADD COLUMN IF NOT EXISTS design_project_id uuid,
        ADD COLUMN IF NOT EXISTS design_version_id uuid,
        ADD COLUMN IF NOT EXISTS scheduled_for timestamptz,
        ADD COLUMN IF NOT EXISTS business_time_zone text,
        ADD COLUMN IF NOT EXISTS gmail_draft_id text,
        ADD COLUMN IF NOT EXISTS gmail_message_id text,
        ADD COLUMN IF NOT EXISTS gmail_thread_id text,
        ADD COLUMN IF NOT EXISTS send_request_key text,
        ADD COLUMN IF NOT EXISTS schedule_request_key text,
        ADD COLUMN IF NOT EXISTS dispatch_lease_owner text,
        ADD COLUMN IF NOT EXISTS dispatch_lease_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS dispatch_attempt_count integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
        ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_failure_code text,
        ADD COLUMN IF NOT EXISTS last_failure_message text;
      ALTER TABLE office_email_drafts
        DROP CONSTRAINT IF EXISTS office_email_drafts_state_check,
        DROP CONSTRAINT IF EXISTS office_email_drafts_state_valid,
        DROP CONSTRAINT IF EXISTS office_email_drafts_body_format_check,
        DROP CONSTRAINT IF EXISTS office_email_drafts_body_format_valid;
      ALTER TABLE office_email_drafts
        ADD CONSTRAINT office_email_drafts_state_valid
          CHECK (state IN ('draft','submitted','needs_changes','gmail_draft','scheduled','sending','sent','failed','cancelled')),
        ADD CONSTRAINT office_email_drafts_body_format_valid
          CHECK (body_format IN ('plain_text','html'));
      CREATE INDEX IF NOT EXISTS office_email_drafts_state_submitted_idx
        ON office_email_drafts (state, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS office_email_drafts_account_updated_idx
        ON office_email_drafts (office_account_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS office_email_drafts_template_idx
        ON office_email_drafts (communication_template_id)
        WHERE communication_template_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_design_project_unique
        ON office_email_drafts (design_project_id)
        WHERE design_project_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_send_request_unique
        ON office_email_drafts (send_request_key)
        WHERE send_request_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS office_email_drafts_schedule_request_unique
        ON office_email_drafts (schedule_request_key)
        WHERE schedule_request_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS office_email_drafts_dispatch_idx
        ON office_email_drafts (state, scheduled_for, next_attempt_at, dispatch_lease_expires_at);

      CREATE TABLE IF NOT EXISTS office_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        actor_kind text NOT NULL CHECK (actor_kind IN ('office','owner')),
        body text NOT NULL,
        read_by_office_at timestamptz,
        read_by_owner_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS office_messages_account_created_idx
        ON office_messages (office_account_id, created_at DESC);
    `);
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
  }

  return true;
}
