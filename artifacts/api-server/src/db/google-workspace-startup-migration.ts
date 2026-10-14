import { isGoogleWorkspaceSchemaReady } from "./google-workspace-schema-readiness";
type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function ensureGoogleWorkspaceSchema(
  client: Client,
): Promise<boolean> {
  if (await isGoogleWorkspaceSchemaReady(client)) return true;
  await client.query("SET lock_timeout = '5s'");
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS google_workspace_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        account_email text NOT NULL,
        status text NOT NULL DEFAULT 'connected',
        encrypted_refresh_token jsonb NOT NULL,
        granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
        google_subject text,
        connected_at timestamptz NOT NULL DEFAULT now(),
        last_verified_at timestamptz,
        disconnected_at timestamptz,
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_connections_account_email_unique
          UNIQUE (account_email),
        CONSTRAINT google_workspace_connections_status_valid
          CHECK (status IN ('connected', 'reauthorization_required', 'disconnected')),
        CONSTRAINT google_workspace_connections_encrypted_token_object
          CHECK (jsonb_typeof(encrypted_refresh_token) = 'object'),
        CONSTRAINT google_workspace_connections_granted_scopes_array
          CHECK (jsonb_typeof(granted_scopes) = 'array')
      );
      CREATE INDEX IF NOT EXISTS google_workspace_connections_status_idx
        ON google_workspace_connections (status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS google_workspace_oauth_states (
        state_hash text PRIMARY KEY,
        return_path text NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_oauth_states_return_path_nonblank
          CHECK (btrim(return_path) <> '')
      );
      CREATE INDEX IF NOT EXISTS google_workspace_oauth_states_unconsumed_expiry_idx
        ON google_workspace_oauth_states (expires_at)
        WHERE consumed_at IS NULL;

      CREATE TABLE IF NOT EXISTS google_workspace_label_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        label_id text NOT NULL,
        label_name text NOT NULL,
        root_label_id text NOT NULL,
        root_label_name text NOT NULL,
        selected boolean NOT NULL DEFAULT true,
        discovered_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_label_scopes_connection_label_unique
          UNIQUE (connection_id, label_id),
        CONSTRAINT google_workspace_label_scopes_identity_nonblank
          CHECK (
            btrim(label_id) <> '' AND
            btrim(label_name) <> '' AND
            btrim(root_label_id) <> '' AND
            btrim(root_label_name) <> ''
          )
      );
      CREATE INDEX IF NOT EXISTS google_workspace_label_scopes_selected_idx
        ON google_workspace_label_scopes (connection_id, root_label_id, label_id)
        WHERE selected = true;

      CREATE TABLE IF NOT EXISTS google_workspace_calendar_scopes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        calendar_id text NOT NULL,
        summary text NOT NULL,
        primary_calendar boolean NOT NULL DEFAULT false,
        selected boolean NOT NULL DEFAULT true,
        discovered_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_calendar_scopes_connection_calendar_unique
          UNIQUE (connection_id, calendar_id),
        CONSTRAINT google_workspace_calendar_scopes_identity_nonblank
          CHECK (btrim(calendar_id) <> '' AND btrim(summary) <> '')
      );
      CREATE INDEX IF NOT EXISTS google_workspace_calendar_scopes_selected_idx
        ON google_workspace_calendar_scopes (connection_id, calendar_id)
        WHERE selected = true;

      CREATE TABLE IF NOT EXISTS google_workspace_validation_mappings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        message_id text NOT NULL,
        thread_id text NOT NULL,
        organization_id uuid NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        contact_id uuid
          REFERENCES contacts(id) ON DELETE SET NULL,
        evidence_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_validation_mapping_unique
          UNIQUE (connection_id, message_id),
        CONSTRAINT google_workspace_validation_identity_nonblank
          CHECK (btrim(message_id) <> '' AND btrim(thread_id) <> ''),
        CONSTRAINT google_workspace_validation_evidence_array
          CHECK (jsonb_typeof(evidence_codes) = 'array')
      );
      CREATE INDEX IF NOT EXISTS google_workspace_validation_org_idx
        ON google_workspace_validation_mappings
          (connection_id, organization_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS google_workspace_validation_thread_idx
        ON google_workspace_validation_mappings
          (connection_id, thread_id);

      CREATE TABLE IF NOT EXISTS google_workspace_validation_state (
        connection_id uuid PRIMARY KEY
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        validation_status text NOT NULL DEFAULT 'not_started',
        reviewed_by text,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_validation_status_valid
          CHECK (validation_status IN ('not_started', 'ready_for_review', 'approved', 'rejected'))
      );

      CREATE TABLE IF NOT EXISTS google_workspace_validation_review_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        message_id text NOT NULL,
        thread_id text NOT NULL,
        subject text NOT NULL DEFAULT '',
        from_header text NOT NULL DEFAULT '',
        to_header text NOT NULL DEFAULT '',
        internal_date_ms bigint,
        evidence_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
        candidate_organizations jsonb NOT NULL DEFAULT '[]'::jsonb,
        has_attachments boolean NOT NULL DEFAULT false,
        review_state text NOT NULL DEFAULT 'pending',
        resolved_organization_id uuid
          REFERENCES organizations(id) ON DELETE RESTRICT,
        reviewed_by text,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_validation_review_unique
          UNIQUE (connection_id, message_id),
        CONSTRAINT google_workspace_validation_review_identity_nonblank
          CHECK (btrim(message_id) <> '' AND btrim(thread_id) <> ''),
        CONSTRAINT google_workspace_validation_review_evidence_array
          CHECK (jsonb_typeof(evidence_codes) = 'array'),
        CONSTRAINT google_workspace_validation_review_candidates_array
          CHECK (jsonb_typeof(candidate_organizations) = 'array'),
        CONSTRAINT google_workspace_validation_review_state_valid
          CHECK (review_state IN ('pending', 'resolved', 'ignored')),
        CONSTRAINT google_workspace_validation_review_resolution_consistent
          CHECK (
            (review_state = 'resolved' AND resolved_organization_id IS NOT NULL)
            OR (review_state <> 'resolved' AND resolved_organization_id IS NULL)
          )
      );
      ALTER TABLE google_workspace_validation_review_items ADD COLUMN IF NOT EXISTS reviewed_by text;
      ALTER TABLE google_workspace_validation_review_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
      CREATE INDEX IF NOT EXISTS google_workspace_validation_review_pending_idx
        ON google_workspace_validation_review_items
          (connection_id, updated_at DESC)
        WHERE review_state = 'pending';

      CREATE TABLE IF NOT EXISTS google_workspace_profile_email_threads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        contact_id uuid
          REFERENCES contacts(id) ON DELETE SET NULL,
        subject text NOT NULL DEFAULT '',
        original_gmail_url text,
        archive_state text NOT NULL DEFAULT 'pending',
        last_synced_at timestamptz,
        last_gmail_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_profile_email_threads_state_valid
          CHECK (archive_state IN ('pending','complete','partial','failed'))
      );
      CREATE INDEX IF NOT EXISTS google_workspace_profile_email_threads_org_idx
        ON google_workspace_profile_email_threads
          (connection_id, organization_id, last_synced_at DESC);

      CREATE TABLE IF NOT EXISTS google_workspace_profile_email_thread_sources (
        conversation_id uuid NOT NULL
          REFERENCES google_workspace_profile_email_threads(id) ON DELETE CASCADE,
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        gmail_thread_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (connection_id, gmail_thread_id),
        CONSTRAINT google_workspace_profile_email_thread_sources_identity_nonblank
          CHECK (btrim(gmail_thread_id) <> ''),
        CONSTRAINT google_workspace_profile_email_thread_sources_conversation_unique
          UNIQUE (conversation_id, gmail_thread_id)
      );

      CREATE TABLE IF NOT EXISTS google_workspace_profile_email_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id uuid NOT NULL
          REFERENCES google_workspace_profile_email_threads(id) ON DELETE CASCADE,
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        gmail_message_id text NOT NULL,
        gmail_thread_id text NOT NULL,
        internal_date_ms bigint,
        from_value text NOT NULL DEFAULT '',
        to_value text NOT NULL DEFAULT '',
        cc_value text NOT NULL DEFAULT '',
        subject text NOT NULL DEFAULT '',
        date_value text NOT NULL DEFAULT '',
        direction text NOT NULL DEFAULT 'unknown',
        body_text text NOT NULL DEFAULT '',
        body_html text,
        attachments_json jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_profile_email_messages_source_unique
          UNIQUE (connection_id, gmail_message_id),
        CONSTRAINT google_workspace_profile_email_messages_identity_nonblank
          CHECK (btrim(gmail_message_id) <> '' AND btrim(gmail_thread_id) <> ''),
        CONSTRAINT google_workspace_profile_email_messages_direction_valid
          CHECK (direction IN ('incoming','outgoing','unknown')),
        CONSTRAINT google_workspace_profile_email_messages_attachments_array
          CHECK (jsonb_typeof(attachments_json) = 'array')
      );
      ALTER TABLE google_workspace_profile_email_messages ADD COLUMN IF NOT EXISTS body_html text;
      CREATE INDEX IF NOT EXISTS google_workspace_profile_email_messages_conversation_idx
        ON google_workspace_profile_email_messages
          (connection_id, conversation_id, internal_date_ms, created_at);

      CREATE TABLE IF NOT EXISTS google_workspace_profile_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        thread_id text NOT NULL,
        message_id text NOT NULL,
        attachment_id text NOT NULL,
        filename text NOT NULL,
        mime_type text NOT NULL,
        size_bytes bigint NOT NULL,
        content_sha256 text,
        storage_object_key text,
        availability text NOT NULL DEFAULT 'retry_required',
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_profile_files_source_unique
          UNIQUE (connection_id, message_id, attachment_id),
        CONSTRAINT google_workspace_profile_files_identity_nonblank
          CHECK (
            btrim(thread_id) <> '' AND
            btrim(message_id) <> '' AND
            btrim(attachment_id) <> '' AND
            btrim(filename) <> '' AND
            btrim(mime_type) <> ''
          ),
        CONSTRAINT google_workspace_profile_files_size_valid
          CHECK (size_bytes >= 0),
        CONSTRAINT google_workspace_profile_files_availability_valid
          CHECK (availability IN ('available', 'file_unavailable', 'retry_required')),
        CONSTRAINT google_workspace_profile_files_available_has_storage
          CHECK (
            availability <> 'available'
            OR (
              content_sha256 IS NOT NULL AND btrim(content_sha256) <> '' AND
              storage_object_key IS NOT NULL AND btrim(storage_object_key) <> ''
            )
          )
      );
      CREATE INDEX IF NOT EXISTS google_workspace_profile_files_org_idx
        ON google_workspace_profile_files
          (connection_id, organization_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS google_workspace_profile_files_checksum_idx
        ON google_workspace_profile_files
          (connection_id, content_sha256)
        WHERE content_sha256 IS NOT NULL;

      CREATE TABLE IF NOT EXISTS google_workspace_profile_labels (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        organization_id uuid NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        gmail_label_id text NOT NULL,
        gmail_label_name text NOT NULL,
        state text NOT NULL DEFAULT 'active',
        last_error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_profile_labels_connection_organization_unique
          UNIQUE (connection_id, organization_id),
        CONSTRAINT google_workspace_profile_labels_connection_label_unique
          UNIQUE (connection_id, gmail_label_id),
        CONSTRAINT google_workspace_profile_labels_identity_nonblank
          CHECK (btrim(gmail_label_id) <> '' AND btrim(gmail_label_name) <> ''),
        CONSTRAINT google_workspace_profile_labels_state_valid
          CHECK (state IN ('active','conflict','unavailable'))
      );

      CREATE TABLE IF NOT EXISTS google_workspace_gmail_mutations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        message_id text NOT NULL,
        thread_id text NOT NULL,
        organization_id uuid NOT NULL
          REFERENCES organizations(id) ON DELETE RESTRICT,
        operation text NOT NULL,
        target_label_id text,
        remove_label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
        idempotency_key text NOT NULL,
        state text NOT NULL DEFAULT 'pending',
        attempt_count integer NOT NULL DEFAULT 0,
        last_error_code text,
        next_attempt_at timestamptz,
        processing_lease_expires_at timestamptz,
        actor_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_gmail_mutations_idempotency_unique
          UNIQUE (idempotency_key),
        CONSTRAINT google_workspace_gmail_mutations_identity_nonblank
          CHECK (btrim(message_id) <> '' AND btrim(thread_id) <> '' AND btrim(idempotency_key) <> ''),
        CONSTRAINT google_workspace_gmail_mutations_operation_valid
          CHECK (operation IN ('assign_thread','label_inbound_message')),
        CONSTRAINT google_workspace_gmail_mutations_state_valid
          CHECK (state IN ('pending','processing','completed','retryable_error','permanent_error','conflict')),
        CONSTRAINT google_workspace_gmail_mutations_remove_labels_array
          CHECK (jsonb_typeof(remove_label_ids) = 'array'),
        CONSTRAINT google_workspace_gmail_mutations_attempt_nonnegative
          CHECK (attempt_count >= 0)
      );
      ALTER TABLE google_workspace_gmail_mutations
        ADD COLUMN IF NOT EXISTS intent_generation bigint;
      ALTER TABLE google_workspace_gmail_mutations
        DROP CONSTRAINT IF EXISTS google_workspace_gmail_mutations_operation_valid;
      ALTER TABLE google_workspace_gmail_mutations
        ADD CONSTRAINT google_workspace_gmail_mutations_operation_valid
          CHECK (operation IN ('assign_thread','link_thread','label_inbound_message'));
      CREATE TABLE IF NOT EXISTS google_workspace_mailbox_sends (
        connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        draft_id text NOT NULL,
        revision text NOT NULL,
        state text NOT NULL CHECK (state IN ('sending','sent','uncertain')),
        message_id text,
        thread_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (connection_id, draft_id)
      );
      CREATE INDEX IF NOT EXISTS google_workspace_gmail_mutations_retry_idx
        ON google_workspace_gmail_mutations
          (state, next_attempt_at, processing_lease_expires_at);

      CREATE TABLE IF NOT EXISTS google_workspace_gmail_thread_intents (
        connection_id uuid NOT NULL
          REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        thread_id text NOT NULL,
        generation bigint NOT NULL DEFAULT 1,
        intent_kind text NOT NULL,
        organization_id uuid
          REFERENCES organizations(id) ON DELETE RESTRICT,
        current_mutation_id uuid
          REFERENCES google_workspace_gmail_mutations(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (connection_id, thread_id),
        CONSTRAINT google_workspace_gmail_thread_intents_thread_nonblank
          CHECK (btrim(thread_id) <> ''),
        CONSTRAINT google_workspace_gmail_thread_intents_generation_positive
          CHECK (generation > 0),
        CONSTRAINT google_workspace_gmail_thread_intents_kind_valid
          CHECK (intent_kind IN ('assign','ignore')),
        CONSTRAINT google_workspace_gmail_thread_intents_assignment_consistent
          CHECK (
            (intent_kind = 'assign' AND organization_id IS NOT NULL)
            OR (intent_kind = 'ignore' AND organization_id IS NULL AND current_mutation_id IS NULL)
          )
      );
      CREATE INDEX IF NOT EXISTS google_workspace_gmail_thread_intents_mutation_idx
        ON google_workspace_gmail_thread_intents (current_mutation_id)
        WHERE current_mutation_id IS NOT NULL;

      WITH latest_review AS (
        SELECT DISTINCT ON (connection_id, thread_id)
               connection_id, thread_id, review_state,
               resolved_organization_id, updated_at
          FROM google_workspace_validation_review_items
         ORDER BY connection_id, thread_id, updated_at DESC, id DESC
      ),
      restored AS (
        SELECT review.connection_id,
               review.thread_id,
               CASE WHEN review.review_state = 'ignored' THEN 'ignore' ELSE 'assign' END AS intent_kind,
               CASE WHEN review.review_state = 'resolved'
                    THEN review.resolved_organization_id ELSE NULL END AS organization_id,
               CASE WHEN review.review_state = 'resolved'
                    THEN mutation.id ELSE NULL END AS current_mutation_id
          FROM latest_review review
          LEFT JOIN LATERAL (
            SELECT candidate.id
              FROM google_workspace_gmail_mutations candidate
             WHERE candidate.connection_id = review.connection_id
               AND candidate.thread_id = review.thread_id
               AND candidate.operation = 'assign_thread'
               AND candidate.organization_id = review.resolved_organization_id
             ORDER BY candidate.created_at DESC, candidate.id DESC
             LIMIT 1
          ) mutation ON true
         WHERE review.review_state IN ('resolved','ignored')
      )
      INSERT INTO google_workspace_gmail_thread_intents (
        connection_id, thread_id, generation, intent_kind,
        organization_id, current_mutation_id
      )
      SELECT connection_id, thread_id, 1, intent_kind,
             organization_id, current_mutation_id
        FROM restored
       WHERE intent_kind = 'ignore' OR current_mutation_id IS NOT NULL
      ON CONFLICT (connection_id, thread_id) DO NOTHING;

      UPDATE google_workspace_gmail_mutations mutation
         SET intent_generation = intent.generation
        FROM google_workspace_gmail_thread_intents intent
       WHERE mutation.id = intent.current_mutation_id
         AND mutation.intent_generation IS NULL;

      UPDATE google_workspace_gmail_mutations mutation
         SET intent_generation = intent.generation,
             updated_at = now()
        FROM google_workspace_gmail_thread_intents intent
       WHERE mutation.connection_id = intent.connection_id
         AND mutation.thread_id = intent.thread_id
         AND mutation.operation = 'label_inbound_message'
         AND mutation.organization_id = intent.organization_id
         AND mutation.state IN ('pending','processing','retryable_error')
         AND mutation.intent_generation IS NULL
         AND intent.intent_kind = 'assign';

      UPDATE google_workspace_gmail_mutations mutation
         SET state = 'permanent_error',
             last_error_code = 'GOOGLE_WORKSPACE_THREAD_INTENT_SUPERSEDED',
             next_attempt_at = NULL,
             processing_lease_expires_at = NULL,
             updated_at = now()
       WHERE mutation.operation = 'label_inbound_message'
         AND mutation.state IN ('pending','processing','retryable_error')
         AND EXISTS (
           SELECT 1
             FROM google_workspace_gmail_thread_intents intent
            WHERE intent.connection_id = mutation.connection_id
              AND intent.thread_id = mutation.thread_id
              AND (
                intent.intent_kind = 'ignore'
                OR intent.organization_id <> mutation.organization_id
              )
         );

      ALTER TABLE google_workspace_validation_review_items
        ADD COLUMN IF NOT EXISTS gmail_sync_state text NOT NULL DEFAULT 'not_requested';
      ALTER TABLE google_workspace_validation_review_items
        ADD COLUMN IF NOT EXISTS gmail_sync_error_code text;
      ALTER TABLE google_workspace_validation_review_items
        ADD COLUMN IF NOT EXISTS gmail_sync_mutation_id uuid
          REFERENCES google_workspace_gmail_mutations(id) ON DELETE SET NULL;
      ALTER TABLE google_workspace_validation_review_items
        DROP CONSTRAINT IF EXISTS google_workspace_validation_review_gmail_sync_state_valid;
      ALTER TABLE google_workspace_validation_review_items
        ADD CONSTRAINT google_workspace_validation_review_gmail_sync_state_valid
          CHECK (gmail_sync_state IN (
            'not_requested','pending','completed','retryable_error','permanent_error','conflict'
          ));

      CREATE TABLE IF NOT EXISTS google_workspace_audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_kind text NOT NULL,
        actor_id text,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT google_workspace_audit_events_actor_kind_valid
          CHECK (actor_kind IN ('owner', 'office', 'system')),
        CONSTRAINT google_workspace_audit_events_action_nonblank
          CHECK (btrim(action) <> ''),
        CONSTRAINT google_workspace_audit_events_target_type_nonblank
          CHECK (btrim(target_type) <> ''),
        CONSTRAINT google_workspace_audit_events_metadata_object
          CHECK (jsonb_typeof(metadata) = 'object')
      );
      CREATE INDEX IF NOT EXISTS google_workspace_audit_events_created_idx
        ON google_workspace_audit_events (created_at DESC, id DESC);
    `);
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
  }

  return true;
}
