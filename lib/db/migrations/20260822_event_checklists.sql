CREATE TABLE IF NOT EXISTS event_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  phase text NOT NULL,
  version integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checklist_templates_phase_valid CHECK (phase IN ('pre_event','post_event')),
  CONSTRAINT event_checklist_templates_version_positive CHECK (version > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_templates_code_unique
  ON event_checklist_templates(code);

CREATE TABLE IF NOT EXISTS event_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES event_checklist_templates(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  scope text NOT NULL,
  applicability_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  safety_critical boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checklist_template_items_scope_valid CHECK (scope IN ('site','resource'))
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_template_items_template_code_unique
  ON event_checklist_template_items(template_id, code);
CREATE INDEX IF NOT EXISTS event_checklist_template_items_template_order_idx
  ON event_checklist_template_items(template_id, sort_order);

CREATE TABLE IF NOT EXISTS event_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_mutation_id uuid NOT NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  leg_id uuid NOT NULL REFERENCES travel_legs(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES event_checklist_templates(id) ON DELETE RESTRICT,
  phase text NOT NULL,
  state text NOT NULL DEFAULT 'in_progress',
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  unable_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checklist_runs_phase_valid CHECK (phase IN ('pre_event','post_event')),
  CONSTRAINT event_checklist_runs_state_valid CHECK (state IN ('in_progress','completed','unable_to_complete')),
  CONSTRAINT event_checklist_runs_unable_reason_required CHECK (
    state <> 'unable_to_complete' OR NULLIF(trim(unable_reason), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_runs_client_mutation_unique
  ON event_checklist_runs(client_mutation_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_runs_booking_leg_phase_unique
  ON event_checklist_runs(booking_id, leg_id, phase);
CREATE INDEX IF NOT EXISTS event_checklist_runs_booking_leg_phase_idx
  ON event_checklist_runs(booking_id, leg_id, phase);
CREATE INDEX IF NOT EXISTS event_checklist_runs_leg_state_idx
  ON event_checklist_runs(leg_id, state);

CREATE TABLE IF NOT EXISTS event_checklist_item_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES event_checklist_runs(id) ON DELETE CASCADE,
  template_item_id uuid NOT NULL REFERENCES event_checklist_template_items(id) ON DELETE RESTRICT,
  resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
  item_code_snapshot text NOT NULL,
  item_label_snapshot text NOT NULL,
  resource_name_snapshot text,
  result text,
  note text,
  follow_up_sync_state text NOT NULL DEFAULT 'not_required',
  client_mutation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checklist_item_results_result_valid CHECK (
    result IS NULL OR result IN ('acceptable','needs_work_safe','unsafe','not_applicable')
  ),
  CONSTRAINT event_checklist_item_results_followup_valid CHECK (
    follow_up_sync_state IN ('not_required','pending','synced','needs_attention')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_item_results_client_mutation_unique
  ON event_checklist_item_results(client_mutation_id);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_item_results_identity_unique
  ON event_checklist_item_results (
    run_id,
    template_item_id,
    COALESCE(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS event_checklist_item_results_run_result_idx
  ON event_checklist_item_results(run_id, result);

CREATE TABLE IF NOT EXISTS event_checklist_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result_id uuid NOT NULL REFERENCES event_checklist_item_results(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  storage_key text,
  uploaded_at timestamptz,
  client_mutation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_attachments_client_mutation_unique
  ON event_checklist_attachments(client_mutation_id);
CREATE INDEX IF NOT EXISTS event_checklist_attachments_result_idx
  ON event_checklist_attachments(result_id);

CREATE TABLE IF NOT EXISTS resource_condition_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  checklist_result_id uuid NOT NULL REFERENCES event_checklist_item_results(id) ON DELETE RESTRICT,
  severity text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  summary text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT resource_condition_issues_severity_valid CHECK (severity IN ('needs_work_safe','unsafe')),
  CONSTRAINT resource_condition_issues_state_valid CHECK (state IN ('open','resolved')),
  CONSTRAINT resource_condition_issues_note_nonblank CHECK (NULLIF(trim(note), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS resource_condition_issues_result_unique
  ON resource_condition_issues(checklist_result_id);
CREATE INDEX IF NOT EXISTS resource_condition_issues_resource_state_idx
  ON resource_condition_issues(resource_id, state);

CREATE TABLE IF NOT EXISTS event_checklist_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES event_checklist_runs(id) ON DELETE CASCADE,
  action text NOT NULL,
  reason text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_checklist_overrides_action_valid CHECK (
    action IN ('allow_ready_to_operate','allow_checkout')
  ),
  CONSTRAINT event_checklist_overrides_reason_nonblank CHECK (
    NULLIF(trim(reason), '') IS NOT NULL
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS event_checklist_overrides_run_action_unique
  ON event_checklist_overrides(run_id, action);
CREATE INDEX IF NOT EXISTS event_checklist_overrides_run_idx
  ON event_checklist_overrides(run_id);
