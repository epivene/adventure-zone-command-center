CREATE TABLE IF NOT EXISTS commercial_offer_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'proposed',
  audience text NOT NULL DEFAULT 'owner_only',
  source_document_id uuid REFERENCES business_source_documents(id) ON DELETE SET NULL,
  calculation_type text NOT NULL,
  amount_cents integer,
  amount_basis_points integer,
  calculation_scope text,
  stack_policy text NOT NULL DEFAULT 'manual',
  applies_to_package_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  new_customer_only boolean NOT NULL DEFAULT false,
  repeat_customer_only boolean NOT NULL DEFAULT false,
  requires_owner_confirmation boolean NOT NULL DEFAULT true,
  deadline_mode text NOT NULL DEFAULT 'none',
  deadline_days integer,
  fixed_deadline date,
  customer_summary text,
  internal_conditions text NOT NULL,
  source_conflict_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commercial_offer_rules_kind_valid
    CHECK (kind IN ('discount','payment_option','fee')),
  CONSTRAINT commercial_offer_rules_state_valid
    CHECK (state IN ('proposed','active','archived')),
  CONSTRAINT commercial_offer_rules_audience_valid
    CHECK (audience IN ('owner_only','customer_safe')),
  CONSTRAINT commercial_offer_rules_calculation_valid
    CHECK (calculation_type IN ('fixed_cents','percent_basis_points','revenue_share','variable')),
  CONSTRAINT commercial_offer_rules_stack_policy_valid
    CHECK (stack_policy IN ('stackable','exclusive','manual')),
  CONSTRAINT commercial_offer_rules_deadline_mode_valid
    CHECK (deadline_mode IN ('none','manual','days_after_trigger','fixed_date')),
  CONSTRAINT commercial_offer_rules_amount_cents_nonnegative
    CHECK (amount_cents IS NULL OR amount_cents >= 0),
  CONSTRAINT commercial_offer_rules_basis_points_range
    CHECK (amount_basis_points IS NULL OR (amount_basis_points >= 0 AND amount_basis_points <= 10000)),
  CONSTRAINT commercial_offer_rules_deadline_days_nonnegative
    CHECK (deadline_days IS NULL OR deadline_days >= 0),
  CONSTRAINT commercial_offer_rules_customer_flags_not_contradictory
    CHECK (NOT (new_customer_only AND repeat_customer_only)),
  CONSTRAINT commercial_offer_rules_internal_conditions_nonblank
    CHECK (NULLIF(trim(internal_conditions), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_offer_rules_code_unique
  ON commercial_offer_rules(code);
CREATE INDEX IF NOT EXISTS commercial_offer_rules_state_audience_kind_idx
  ON commercial_offer_rules(state, audience, kind);
CREATE INDEX IF NOT EXISTS commercial_offer_rules_source_document_idx
  ON commercial_offer_rules(source_document_id);
