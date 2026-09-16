create extension if not exists pgcrypto;

alter table organizations add column if not exists description text;

create table if not exists office_accounts (
  id uuid primary key default gen_random_uuid(),
  login_name text not null,
  display_name text not null,
  role text not null default 'office_coordinator' check (role = 'office_coordinator'),
  password_hash text not null,
  password_salt text not null,
  enabled boolean not null default true,
  session_version bigint not null default 1 check (session_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists office_accounts_login_name_lower_unique
  on office_accounts (lower(login_name));

create table if not exists office_tasks (
  id uuid primary key default gen_random_uuid(),
  office_account_id uuid not null references office_accounts(id) on delete restrict,
  task_type text not null check (task_type in ('contact_verification','mail_brochure','follow_up_prep','research_update','draft_email','other')),
  title text not null,
  instructions text,
  organization_id uuid references organizations(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  status text not null default 'todo' check (status in ('todo','in_progress','waiting','done','cancelled')),
  needs_help boolean not null default false,
  coordinator_note text,
  owner_sort_order bigint not null,
  due_at timestamptz,
  created_by text not null default 'owner' check (created_by in ('owner','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists office_tasks_account_status_order_idx
  on office_tasks (office_account_id, status, owner_sort_order, id);
create index if not exists office_tasks_needs_help_idx
  on office_tasks (office_account_id, needs_help, updated_at desc);

create table if not exists office_mail_activity (
  id uuid primary key default gen_random_uuid(),
  office_account_id uuid not null references office_accounts(id) on delete restrict,
  task_id uuid references office_tasks(id) on delete set null,
  organization_id uuid not null references organizations(id) on delete restrict,
  contact_id uuid references contacts(id) on delete set null,
  recipient_name text,
  address_1_snapshot text,
  address_2_snapshot text,
  city_snapshot text,
  region_snapshot text,
  postal_code_snapshot text,
  prepared_at timestamptz,
  mailed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists office_mail_activity_task_unique
  on office_mail_activity (task_id) where task_id is not null;
create index if not exists office_mail_activity_profile_mailed_idx
  on office_mail_activity (organization_id, mailed_at desc);
create index if not exists office_mail_activity_account_created_idx
  on office_mail_activity (office_account_id, created_at desc);

create table if not exists office_email_drafts (
  id uuid primary key default gen_random_uuid(),
  office_account_id uuid not null references office_accounts(id) on delete restrict,
  organization_id uuid not null references organizations(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete restrict,
  recipient_email text not null,
  subject text not null,
  body text not null,
  coordinator_note text,
  state text not null default 'draft' check (state in ('draft','submitted','needs_changes','sending','sent')),
  submitted_at timestamptz,
  owner_return_note text,
  sent_at timestamptz,
  sent_message_id text,
  last_send_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists office_email_drafts_state_submitted_idx
  on office_email_drafts (state, submitted_at desc);
create index if not exists office_email_drafts_account_updated_idx
  on office_email_drafts (office_account_id, updated_at desc);

create table if not exists office_messages (
  id uuid primary key default gen_random_uuid(),
  office_account_id uuid not null references office_accounts(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('office','owner')),
  body text not null,
  read_by_office_at timestamptz,
  read_by_owner_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists office_messages_account_created_idx
  on office_messages (office_account_id, created_at desc);

