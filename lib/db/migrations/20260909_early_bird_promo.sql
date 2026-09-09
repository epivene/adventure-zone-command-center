ALTER TABLE office_email_drafts
  ALTER COLUMN office_account_id DROP NOT NULL;

ALTER TABLE office_email_drafts
  ADD COLUMN IF NOT EXISTS booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE office_email_drafts
  ADD COLUMN IF NOT EXISTS event_year integer;

ALTER TABLE office_email_drafts
  DROP CONSTRAINT IF EXISTS office_email_drafts_state_valid;

ALTER TABLE office_email_drafts
  ADD CONSTRAINT office_email_drafts_state_valid
  CHECK (state IN ('draft','submitted','needs_changes','sending','sent','cancelled'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'office_email_drafts'::regclass
      AND conname = 'office_email_drafts_event_year_valid'
  ) THEN
    ALTER TABLE office_email_drafts
      ADD CONSTRAINT office_email_drafts_event_year_valid
      CHECK (event_year IS NULL OR event_year BETWEEN 2000 AND 2200);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS office_email_drafts_organization_year_idx
  ON office_email_drafts (organization_id, event_year);

CREATE TABLE IF NOT EXISTS early_bird_promo_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_offer_rule_id uuid NOT NULL REFERENCES commercial_offer_rules(id) ON DELETE RESTRICT,
  opportunity_id uuid REFERENCES booking_opportunities(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  office_account_id uuid REFERENCES office_accounts(id) ON DELETE SET NULL,
  event_year integer NOT NULL,
  source_kind text NOT NULL,
  first_email_record_id uuid NOT NULL,
  first_gmail_message_id text,
  first_gmail_thread_id text,
  first_sent_at timestamptz NOT NULL,
  deadline_date date NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  interest_confirmed_at timestamptz,
  interest_evidence_message_id text,
  reminder_due_at timestamptz,
  reminder_draft_id uuid REFERENCES office_email_drafts(id) ON DELETE SET NULL,
  reminder_follow_up_id uuid REFERENCES follow_ups(id) ON DELETE SET NULL,
  deposit_received_at timestamptz,
  deposit_source text,
  cancel_reason text,
  claim_lease_owner text,
  claim_lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT early_bird_promo_status_valid
    CHECK (status IN ('active','secured','expired','cancelled')),
  CONSTRAINT early_bird_promo_source_valid
    CHECK (source_kind IN ('office_email','opportunity_email')),
  CONSTRAINT early_bird_promo_year_valid
    CHECK (event_year BETWEEN 2000 AND 2200),
  CONSTRAINT early_bird_promo_window_valid
    CHECK (expires_at > first_sent_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS early_bird_promo_offer_org_year_unique
  ON early_bird_promo_enrollments
  (commercial_offer_rule_id, organization_id, event_year);

CREATE INDEX IF NOT EXISTS early_bird_promo_due_idx
  ON early_bird_promo_enrollments (status, reminder_due_at);
