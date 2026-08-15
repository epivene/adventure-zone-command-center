create table if not exists leg_manager_access (
  leg_id uuid primary key references travel_legs(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  session_version integer not null default 1,
  manager_name text,
  updated_at timestamptz not null default now(),
  constraint leg_manager_access_session_version_positive check (session_version >= 1)
);
