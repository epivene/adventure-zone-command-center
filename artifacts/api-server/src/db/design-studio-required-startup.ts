import { pool as defaultPool } from "./client";

type QueryClient = {
  query: (text: string, values?: unknown[]) => Promise<unknown>;
};

type PoolLike = {
  connect: () => Promise<QueryClient & { release?: () => void }>;
};

/**
 * Design Studio owns its own tables so creative work can evolve without
 * changing CRM, booking, or communication-template records.
 */
export async function ensureDesignStudioSchemaBeforeListen(
  options: { pool?: PoolLike } = {},
): Promise<boolean> {
  const pool = options.pool ?? (defaultPool as unknown as PoolLike);
  const client = await pool.connect();
  try {
    await client.query("SET lock_timeout = '5s'");
    await client.query(`
      CREATE TABLE IF NOT EXISTS design_projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        name text NOT NULL,
        type text NOT NULL CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','blank')),
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','used','sent','archived')),
        sync_state text NOT NULL DEFAULT 'synced' CHECK (sync_state IN ('synced','pending','failed')),
        content text NOT NULL DEFAULT '',
        notes text,
        canvas jsonb,
        linked_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        linked_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        linked_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS design_projects_account_updated_idx
        ON design_projects (office_account_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS design_projects_status_idx
        ON design_projects (status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS design_project_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES design_projects(id) ON DELETE RESTRICT,
        version_number text NOT NULL,
        content text NOT NULL DEFAULT '',
        notes text,
        canvas jsonb,
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','used','sent','archived')),
        is_immutable boolean NOT NULL DEFAULT false,
        created_by_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        created_at timestamptz NOT NULL DEFAULT now(),
        frozen_at timestamptz,
        UNIQUE (project_id, version_number)
      );
      CREATE INDEX IF NOT EXISTS design_project_versions_project_created_idx
        ON design_project_versions (project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS design_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        created_by_account_id uuid REFERENCES office_accounts(id) ON DELETE SET NULL,
        name text NOT NULL,
        type text NOT NULL CHECK (type IN ('flyer','social_post','email','brochure','review_request','contract','blank')),
        description text,
        tags jsonb NOT NULL DEFAULT '[]'::jsonb,
        visibility text NOT NULL DEFAULT 'shared' CHECK (visibility IN ('private','shared','approved')),
        is_approved boolean NOT NULL DEFAULT false,
        locked_content jsonb,
        content text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS design_templates_type_visibility_idx
        ON design_templates (type, visibility);

      CREATE TABLE IF NOT EXISTS design_template_favorites (
        account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE CASCADE,
        template_id uuid NOT NULL REFERENCES design_templates(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (account_id, template_id)
      );

      CREATE TABLE IF NOT EXISTS design_assets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        uploaded_by_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        name text NOT NULL,
        scope text NOT NULL CHECK (scope IN ('company','package','project','event','profile')),
        storage_key text,
        mime_type text,
        size_bytes text,
        alt_text text,
        project_id uuid REFERENCES design_projects(id) ON DELETE CASCADE,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
        is_approved boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS design_assets_scope_created_idx
        ON design_assets (scope, created_at DESC);
      CREATE INDEX IF NOT EXISTS design_assets_project_idx
        ON design_assets (project_id);

      CREATE TABLE IF NOT EXISTS design_certificates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        name text NOT NULL,
        booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
        organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        asset_id uuid REFERENCES design_assets(id) ON DELETE SET NULL,
        issue_date date,
        expiration_date date,
        review_state text NOT NULL DEFAULT 'needs_review' CHECK (review_state IN ('needs_review','reviewed')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (issue_date IS NULL OR expiration_date IS NULL OR issue_date <= expiration_date)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS design_certificates_asset_unique
        ON design_certificates (asset_id);
      CREATE INDEX IF NOT EXISTS design_certificates_account_expiration_idx
        ON design_certificates (office_account_id, expiration_date);
      CREATE INDEX IF NOT EXISTS design_certificates_booking_idx
        ON design_certificates (booking_id);
      CREATE INDEX IF NOT EXISTS design_certificates_organization_idx
        ON design_certificates (organization_id);

      CREATE TABLE IF NOT EXISTS design_smart_fields (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
        field_key text NOT NULL,
        source_type text NOT NULL,
        source_id uuid,
        value_snapshot text,
        state text NOT NULL DEFAULT 'current' CHECK (state IN ('current','overridden','outdated','unresolved')),
        overridden_value text,
        source_updated_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (project_id, field_key)
      );
      CREATE INDEX IF NOT EXISTS design_smart_fields_project_idx
        ON design_smart_fields (project_id);

      CREATE TABLE IF NOT EXISTS design_outputs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES design_projects(id) ON DELETE RESTRICT,
        version_id uuid NOT NULL REFERENCES design_project_versions(id) ON DELETE RESTRICT,
        created_by_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
        output_type text NOT NULL CHECK (output_type IN ('preview','export','gmail_draft','review_request','contract')),
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','void')),
        storage_key text,
        error_message text,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS design_outputs_project_created_idx
        ON design_outputs (project_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS design_canva_connections (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE CASCADE,
        canva_user_id text,
        encrypted_access_token jsonb NOT NULL,
        encrypted_refresh_token jsonb,
        token_expires_at timestamptz,
        scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','disconnected','error')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS design_canva_connections_account_unique
        ON design_canva_connections (office_account_id);
      CREATE INDEX IF NOT EXISTS design_canva_connections_status_idx
        ON design_canva_connections (status, updated_at DESC);

      CREATE TABLE IF NOT EXISTS design_project_canva_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id uuid NOT NULL REFERENCES design_projects(id) ON DELETE CASCADE,
        design_id text NOT NULL,
        imported_version_id uuid NOT NULL REFERENCES design_project_versions(id) ON DELETE RESTRICT,
        status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
        last_import_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS design_project_canva_links_project_unique
        ON design_project_canva_links (project_id);
      CREATE INDEX IF NOT EXISTS design_project_canva_links_design_idx
        ON design_project_canva_links (design_id);

      CREATE TABLE IF NOT EXISTS design_canva_oauth_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE CASCADE,
        state text NOT NULL,
        encrypted_code_verifier jsonb NOT NULL,
        return_path text NOT NULL DEFAULT '/design-studio',
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS design_canva_oauth_states_state_unique
        ON design_canva_oauth_states (state);
      CREATE INDEX IF NOT EXISTS design_canva_oauth_states_account_idx
        ON design_canva_oauth_states (office_account_id, expires_at DESC);
    `);
    return true;
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
    client.release?.();
  }
}
