type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function ensureWebsiteInquirySchema(
  client: Client,
): Promise<boolean> {
  await client.query("SET lock_timeout = '5s'");
  try {
    await client.query(`
      ALTER TABLE office_accounts
        ADD COLUMN IF NOT EXISTS can_review_website_inquiries boolean NOT NULL DEFAULT false;

      CREATE TABLE IF NOT EXISTS website_inquiries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        submission_id uuid NOT NULL,
        reference_code text NOT NULL,
        status text NOT NULL DEFAULT 'new'
          CHECK (status IN ('new','reviewing','converted','archived','spam')),
        name text NOT NULL,
        email text NOT NULL,
        normalized_email text NOT NULL,
        event_name text NOT NULL,
        event_date date,
        event_location text,
        package_interest text,
        message text NOT NULL,
        page_url text NOT NULL,
        source_origin text NOT NULL,
        content_fingerprint text NOT NULL,
        reviewed_by_kind text
          CHECK (reviewed_by_kind IS NULL OR reviewed_by_kind IN ('owner','office')),
        reviewed_by_id text,
        reviewed_by_name text,
        reviewed_at timestamptz,
        converted_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        converted_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
        converted_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
        converted_at timestamptz,
        alert_state text NOT NULL DEFAULT 'pending'
          CHECK (alert_state IN ('pending','sending','retry','sent','failed')),
        alert_attempt_count integer NOT NULL DEFAULT 0
          CHECK (alert_attempt_count >= 0),
        alert_next_attempt_at timestamptz NOT NULL DEFAULT now(),
        alert_last_attempt_at timestamptz,
        alert_failure_reason text,
        alert_delivered_recipients jsonb NOT NULL DEFAULT '[]'::jsonb
          CHECK (jsonb_typeof(alert_delivered_recipients) = 'array'),
        alert_lease_owner text,
        alert_lease_expires_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE UNIQUE INDEX IF NOT EXISTS website_inquiries_submission_id_unique
        ON website_inquiries (submission_id);
      CREATE UNIQUE INDEX IF NOT EXISTS website_inquiries_reference_code_unique
        ON website_inquiries (reference_code);
      CREATE INDEX IF NOT EXISTS website_inquiries_status_created_idx
        ON website_inquiries (status, created_at DESC);
      CREATE INDEX IF NOT EXISTS website_inquiries_normalized_email_idx
        ON website_inquiries (normalized_email);
      CREATE INDEX IF NOT EXISTS website_inquiries_fingerprint_created_idx
        ON website_inquiries (content_fingerprint, created_at DESC);
      CREATE INDEX IF NOT EXISTS website_inquiries_alert_due_idx
        ON website_inquiries (alert_state, alert_next_attempt_at)
        WHERE alert_state IN ('pending','retry','sending');
    `);

    const marker = await client.query(`SELECT
      to_regclass(current_schema() || '.website_inquiries') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'office_accounts'
          AND column_name = 'can_review_website_inquiries'
      ) AS ready`);
    return marker.rows[0]?.ready === true;
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
  }
}
