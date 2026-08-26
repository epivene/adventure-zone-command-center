alter table if exists lead_import_rows
  drop constraint if exists lead_import_rows_contact_mode_valid;

alter table if exists lead_import_rows
  add constraint lead_import_rows_contact_mode_valid
  check (contact_mode is null or contact_mode in ('existing', 'manual', 'organization_inbox'));
