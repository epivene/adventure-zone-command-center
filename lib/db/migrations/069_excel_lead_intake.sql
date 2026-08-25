create table if not exists lead_import_batches (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null check (btrim(original_filename) <> ''),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'review' check (status in ('review', 'archived')),
  row_count integer not null check (row_count between 1 and 5000),
  imported_by text not null check (btrim(imported_by) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_import_batches_file_sha256_unique
  on lead_import_batches(file_sha256);
create index if not exists lead_import_batches_status_updated_idx
  on lead_import_batches(status, updated_at desc);

create table if not exists lead_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references lead_import_batches(id) on delete cascade,
  sheet_name text not null check (btrim(sheet_name) <> ''),
  source_row_number integer not null check (source_row_number > 0),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  original_values jsonb not null,
  company text,
  phone text,
  address_1 text,
  address_2 text,
  city text,
  region text,
  postal_code text,
  website text,
  industry text,
  warnings jsonb not null default '[]'::jsonb,
  state text not null default 'needs_review'
    check (state in ('needs_review', 'needs_correction', 'verified', 'skipped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_import_rows_source_position_unique
  on lead_import_rows(batch_id, sheet_name, source_row_number);
create unique index if not exists lead_import_rows_fingerprint_unique
  on lead_import_rows(batch_id, source_fingerprint);
create index if not exists lead_import_rows_batch_state_idx
  on lead_import_rows(batch_id, state, source_row_number);
