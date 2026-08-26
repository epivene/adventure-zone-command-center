alter table if exists lead_import_rows
  add column if not exists relationship_outcome text,
  add column if not exists relationship_anchor_at timestamptz,
  add column if not exists relationship_cutoff_date date,
  add column if not exists relationship_evidence_ids jsonb not null default '[]'::jsonb,
  add column if not exists latest_outbound_at timestamptz,
  add column if not exists latest_verified_response_at timestamptz,
  add column if not exists relationship_review_required boolean not null default false,
  add column if not exists relationship_classified_at timestamptz,
  add column if not exists relationship_classified_by text;

alter table if exists lead_import_rows
  drop constraint if exists lead_import_rows_relationship_outcome_valid,
  drop constraint if exists lead_import_rows_relationship_evidence_array,
  drop constraint if exists lead_import_rows_relationship_classification_complete;

alter table if exists lead_import_rows
  add constraint lead_import_rows_relationship_outcome_valid
    check (relationship_outcome is null or relationship_outcome in (
      'returning_contact',
      'reintroduction',
      'prior_outreach_no_response',
      'new_introduction',
      'needs_review'
    )),
  add constraint lead_import_rows_relationship_evidence_array
    check (jsonb_typeof(relationship_evidence_ids) = 'array'),
  add constraint lead_import_rows_relationship_classification_complete
    check (
      relationship_outcome is null or (
        relationship_anchor_at is not null
        and relationship_cutoff_date is not null
        and relationship_classified_at is not null
        and relationship_classified_by is not null
      )
    );

create index if not exists lead_import_rows_relationship_outcome_idx
  on lead_import_rows (relationship_outcome, relationship_classified_at);
