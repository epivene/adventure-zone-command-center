do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'business_documents_category_valid'
      and conrelid = 'business_documents'::regclass
  ) then
    alter table business_documents drop constraint business_documents_category_valid;
  end if;
end $$;

alter table business_documents
  add constraint business_documents_category_valid
  check (category in (
    'contract','invoice','proposal','coi','insurance_policy','w9_tax','permit',
    'vendor_application','inspection','deposit_receipt','operational_template',
    'marketing','other'
  ));

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  document_id uuid not null references business_documents(id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft',
  currency text not null default 'USD',
  total_cents integer not null,
  deposit_cents integer not null default 0,
  issue_date date not null,
  deposit_due_date date,
  balance_due_date date,
  sent_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint invoices_status_valid check (status in ('draft','sent','deposit_due','deposit_paid','paid','cancelled')),
  constraint invoices_amounts_valid check (total_cents >= 0 and deposit_cents >= 0 and deposit_cents <= total_cents),
  constraint invoices_currency_usd check (currency = 'USD'),
  constraint invoices_cancelled_consistent check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index if not exists invoices_profile_number_active_unique
  on invoices (organization_id, invoice_number)
  where cancelled_at is null;
create index if not exists invoices_organization_updated_idx on invoices (organization_id, updated_at);
create index if not exists invoices_booking_updated_idx on invoices (booking_id, updated_at);
create index if not exists invoices_status_due_idx on invoices (status, balance_due_date);

create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete restrict,
  amount_cents integer not null,
  received_date date not null,
  method text,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  constraint invoice_payments_amount_positive check (amount_cents > 0),
  constraint invoice_payments_void_consistent check ((voided_at is null) = (voided_by is null))
);

create index if not exists invoice_payments_invoice_received_idx
  on invoice_payments (invoice_id, received_date);
