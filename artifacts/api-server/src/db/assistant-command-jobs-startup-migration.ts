const assistantCommandJobsSql = `
create table if not exists assistant_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  capability text not null check (capability in ('website_verification')),
  original_instruction text not null,
  normalized_command jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','stopping','stopped','complete','failed')),
  stage text not null default 'queued',
  progress jsonb not null default '{"total":0,"processed":0,"verified":0,"broken":0,"mismatches":0,"review":0,"proposedFixes":0,"cursorAfterId":null}'::jsonb,
  cancel_requested_at timestamptz,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists assistant_jobs_actor_created_idx on assistant_jobs(actor_id, created_at desc);
create index if not exists assistant_jobs_runnable_idx on assistant_jobs(status, lease_expires_at, updated_at);

create table if not exists assistant_job_findings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references assistant_jobs(id) on delete cascade,
  record_id uuid not null,
  record_label text not null,
  saved_url text not null,
  final_url text,
  status text not null check (status in ('verified_match','reachable_uncertain','likely_mismatch','broken','redirected','replacement_found','needs_review')),
  confidence text not null check (confidence in ('high','medium','low')),
  reasons jsonb not null default '[]'::jsonb,
  suggested_url text,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, record_id)
);
create index if not exists assistant_job_findings_job_idx on assistant_job_findings(job_id, created_at, id);

create table if not exists assistant_change_proposals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references assistant_jobs(id) on delete cascade,
  record_id uuid not null,
  field text not null check (field = 'website'),
  old_value text,
  new_value text,
  confidence text not null check (confidence in ('high','medium','low')),
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'proposed' check (status in ('proposed','approved','applied','rejected','failed')),
  approved_by text,
  approved_at timestamptz,
  applied_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  unique(job_id, record_id, field)
);
create index if not exists assistant_change_proposals_job_idx on assistant_change_proposals(job_id, created_at, id);
`;

export async function ensureAssistantCommandJobsSchema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean> {
  const marker = await client.query(`
    select
      to_regclass(current_schema() || '.assistant_jobs') is not null
      and to_regclass(current_schema() || '.assistant_job_findings') is not null
      and to_regclass(current_schema() || '.assistant_change_proposals') is not null
      as ready
  `);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(assistantCommandJobsSql);
  return true;
}
