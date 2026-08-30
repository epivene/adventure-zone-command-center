type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function ensureOperationalCalendarConnectionUpgrade(
  client: Client,
): Promise<boolean> {
  await client.query(`
    ALTER TABLE google_workspace_connections
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'workspace',
      ADD COLUMN IF NOT EXISTS operational_calendar_id text;

    ALTER TABLE google_workspace_oauth_states
      ADD COLUMN IF NOT EXISTS connection_role text NOT NULL DEFAULT 'workspace';

    ALTER TABLE google_workspace_connections
      DROP CONSTRAINT IF EXISTS google_workspace_connections_account_email_unique;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'google_workspace_connections_account_email_role_unique'
          AND conrelid = 'google_workspace_connections'::regclass
      ) THEN
        ALTER TABLE google_workspace_connections
          ADD CONSTRAINT google_workspace_connections_account_email_role_unique
          UNIQUE (account_email, role);
      END IF;
    END $$;

    DROP INDEX IF EXISTS google_workspace_connections_single_active_unique;
    DROP INDEX IF EXISTS google_workspace_connections_active_role_unique;

    CREATE UNIQUE INDEX IF NOT EXISTS google_workspace_connections_active_role_unique
      ON google_workspace_connections (role)
      WHERE status IN ('connected', 'reauthorization_required');

    DO $$ BEGIN
      ALTER TABLE google_workspace_connections
        ADD CONSTRAINT google_workspace_connections_role_valid
        CHECK (role IN ('workspace', 'operational_calendar'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE google_workspace_connections
        ADD CONSTRAINT google_workspace_connections_operational_calendar_role_valid
        CHECK (role = 'operational_calendar' OR operational_calendar_id IS NULL);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      ALTER TABLE google_workspace_oauth_states
        ADD CONSTRAINT google_workspace_oauth_states_connection_role_valid
        CHECK (connection_role IN ('workspace', 'operational_calendar'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS google_operational_calendar_links (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
      calendar_id text NOT NULL,
      google_event_id text NOT NULL,
      booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      package_key text NOT NULL CHECK (package_key IN ('zone','pirates','warrior')),
      etag text,
      source_checksum text NOT NULL,
      last_app_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(last_app_snapshot) = 'object'),
      reserved_starts_at timestamptz NOT NULL,
      reserved_ends_at timestamptz NOT NULL,
      last_synced_at timestamptz,
      last_error_code text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (btrim(calendar_id) <> '' AND btrim(google_event_id) <> '' AND btrim(source_checksum) <> ''),
      CHECK (reserved_ends_at >= reserved_starts_at)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS google_operational_calendar_links_event_unique
      ON google_operational_calendar_links(connection_id, calendar_id, google_event_id);
    CREATE UNIQUE INDEX IF NOT EXISTS google_operational_calendar_links_booking_package_unique
      ON google_operational_calendar_links(connection_id, calendar_id, booking_id, package_key);
    CREATE INDEX IF NOT EXISTS google_operational_calendar_links_booking_idx
      ON google_operational_calendar_links(booking_id);

    CREATE TABLE IF NOT EXISTS google_operational_calendar_reviews (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
      link_id uuid REFERENCES google_operational_calendar_links(id) ON DELETE CASCADE,
      booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
      calendar_id text NOT NULL,
      google_event_id text NOT NULL,
      reason text NOT NULL,
      proposed_changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(proposed_changes) = 'object'),
      state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','rejected')),
      reviewed_by text,
      reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (btrim(calendar_id) <> '' AND btrim(google_event_id) <> '' AND btrim(reason) <> '')
    );
    CREATE INDEX IF NOT EXISTS google_operational_calendar_reviews_pending_idx
      ON google_operational_calendar_reviews(connection_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS google_operational_calendar_reviews_pending_event_unique
      ON google_operational_calendar_reviews(connection_id, calendar_id, google_event_id)
      WHERE state = 'pending';
  `);
  return true;
}
