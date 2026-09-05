create table if not exists contract_agreements (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'adobe_sign',
  project_id uuid not null references design_projects(id) on delete restrict,
  output_id uuid not null references design_outputs(id) on delete restrict,
  version_id uuid not null references design_project_versions(id) on delete restrict,
  organization_id uuid not null references organizations(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  created_by_account_id uuid not null references office_accounts(id) on delete restrict,
  replaced_agreement_id uuid,
  provider_agreement_id text,
  state text not null default 'draft',
  customer_name text not null,
  customer_email text not null,
  david_name text not null,
  david_email text not null,
  sent_at timestamptz,
  customer_signed_at timestamptz,
  countersign_pending_at timestamptz,
  completed_at timestamptz,
  terminal_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_details text,
  signed_pdf_storage_key text,
  audit_trail_storage_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_agreements_provider_valid check (provider in ('adobe_sign')),
  constraint contract_agreements_state_valid check (state in ('draft','ready','pending_customer','customer_signed','countersign_pending','completed','declined','cancelled','expired','failed','replaced')),
  constraint contract_agreements_provider_id_unique unique (provider, provider_agreement_id)
);
create index if not exists contract_agreements_profile_updated_idx on contract_agreements (organization_id, updated_at);
create index if not exists contract_agreements_project_updated_idx on contract_agreements (project_id, updated_at);

create table if not exists contract_provider_events (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references contract_agreements(id) on delete restrict,
  provider_event_id text not null unique,
  event_type text not null,
  provider_status text,
  payload jsonb not null,
  occurred_at timestamptz,
  processed_at timestamptz not null default now()
);
create index if not exists contract_provider_events_agreement_processed_idx on contract_provider_events (agreement_id, processed_at);