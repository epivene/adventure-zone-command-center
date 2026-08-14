-- Forward reconciliation for databases that recorded the original 023 before
-- archive job membership and scoped archive-link provenance were introduced.

LOCK TABLE act_archive_profile_import_jobs IN EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS act_archive_profile_import_sources (
  job_id uuid NOT NULL,
  source_database_key text NOT NULL,
  source_record_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  phase text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Normalize every required object rather than trusting its name. This also
-- repairs partially-pushed or malformed schemas in one migration pass.
DO $$
DECLARE
  constraint_row record;
  local_columns text[];
  referenced_columns text[];
  managed_constraint_names text[] := ARRAY[
    'act_archive_profile_import_sources_pkey',
    'act_archive_profile_import_sources_job_id_source_record_id_key',
    'act_archive_profile_import_sources_job_id_fk',
    'act_archive_profile_import_sources_source_record_id_fk',
    'act_archive_profile_import_sources_source_version_id_fk',
    'act_archive_profile_import_sources_job_database_fk',
    'act_archive_profile_import_sources_source_database_fk',
    'act_archive_profile_import_sources_version_owner_fk',
    'act_archive_profile_import_sources_phase_valid'
  ];
BEGIN
  FOR constraint_row IN
    SELECT constraint_catalog.*
    FROM pg_constraint constraint_catalog
    WHERE constraint_catalog.conrelid = 'act_archive_profile_import_sources'::regclass
  LOOP
    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO local_columns
    FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = key_column.attnum;

    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO referenced_columns
    FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.confrelid
      AND attribute.attnum = key_column.attnum;

    IF constraint_row.conname = ANY(managed_constraint_names)
      OR constraint_row.contype = 'p'
      OR (constraint_row.contype = 'u'
        AND local_columns @> ARRAY['job_id', 'source_record_id']
        AND local_columns <@ ARRAY['job_id', 'source_record_id'])
      OR (constraint_row.contype = 'f'
        AND constraint_row.confdeltype IN ('a', 'r', 'c', 'n', 'd')
        AND (
          local_columns IN (
            ARRAY['job_id'],
            ARRAY['source_record_id'],
            ARRAY['source_version_id'],
            ARRAY['job_id', 'source_database_key'],
            ARRAY['source_record_id', 'source_database_key'],
            ARRAY['source_version_id', 'source_record_id']
          )
          OR (local_columns = ARRAY['job_id']
            AND constraint_row.confrelid = 'act_archive_profile_import_jobs'::regclass
            AND referenced_columns = ARRAY['id'])
          OR (local_columns = ARRAY['job_id', 'source_database_key']
            AND constraint_row.confrelid = 'act_archive_profile_import_jobs'::regclass
            AND referenced_columns = ARRAY['id', 'source_database_key'])
          OR (local_columns = ARRAY['source_record_id', 'source_database_key']
            AND constraint_row.confrelid = 'act_source_records'::regclass
            AND referenced_columns = ARRAY['id', 'source_database_key'])
          OR (local_columns = ARRAY['source_version_id', 'source_record_id']
            AND constraint_row.confrelid = 'act_source_record_versions'::regclass
            AND referenced_columns = ARRAY['id', 'source_record_id'])
        ))
      OR (constraint_row.contype = 'c'
        AND ('phase' = ANY(local_columns)
          OR constraint_row.conname = 'act_archive_profile_import_sources_phase_valid'))
    THEN
      EXECUTE format(
        'ALTER TABLE act_archive_profile_import_sources DROP CONSTRAINT %I',
        constraint_row.conname
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  constraint_row record;
  local_columns text[];
  managed_constraint_names text[] := ARRAY[
    'act_archive_profile_import_jobs_id_database_unique'
  ];
BEGIN
  FOR constraint_row IN
    SELECT constraint_catalog.*
    FROM pg_constraint constraint_catalog
    WHERE constraint_catalog.conrelid = 'act_archive_profile_import_jobs'::regclass
  LOOP
    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO local_columns
    FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = key_column.attnum;

    IF constraint_row.conname = ANY(managed_constraint_names)
      OR (constraint_row.contype = 'u'
        AND 'id' = ANY(local_columns)
        AND local_columns <@ ARRAY['id', 'source_database_key'])
    THEN
      EXECUTE format(
        'ALTER TABLE act_archive_profile_import_jobs DROP CONSTRAINT %I',
        constraint_row.conname
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  index_row record;
BEGIN
  FOR index_row IN
    SELECT index_catalog.indexrelid, index_class.relname,
      index_namespace.nspname AS schema_name
    FROM pg_index index_catalog
    JOIN pg_class index_class ON index_class.oid = index_catalog.indexrelid
    JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
    WHERE index_catalog.indrelid = 'act_archive_profile_import_sources'::regclass
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_catalog
        WHERE constraint_catalog.conindid = index_catalog.indexrelid
      )
      AND (
        index_class.relname = 'act_archive_profile_import_sources_job_phase_source_idx'
        OR (
          index_catalog.indnatts = 3
          AND pg_get_indexdef(index_catalog.indexrelid, 1, true) = 'job_id'
          AND pg_get_indexdef(index_catalog.indexrelid, 2, true) = 'phase'
          AND pg_get_indexdef(index_catalog.indexrelid, 3, true) = 'source_record_id'
        )
      )
  LOOP
    EXECUTE format('DROP INDEX %I.%I', index_row.schema_name, index_row.relname);
  END LOOP;
END $$;

ALTER TABLE act_archive_profile_import_jobs
  ADD CONSTRAINT act_archive_profile_import_jobs_id_database_unique
  UNIQUE (id, source_database_key);

ALTER TABLE act_archive_profile_import_sources
  ADD CONSTRAINT act_archive_profile_import_sources_pkey
    PRIMARY KEY (job_id, source_record_id),
  ADD CONSTRAINT act_archive_profile_import_sources_job_id_fk
    FOREIGN KEY (job_id) REFERENCES act_archive_profile_import_jobs(id) ON DELETE CASCADE,
  ADD CONSTRAINT act_archive_profile_import_sources_source_record_id_fk
    FOREIGN KEY (source_record_id) REFERENCES act_source_records(id) ON DELETE CASCADE,
  ADD CONSTRAINT act_archive_profile_import_sources_source_version_id_fk
    FOREIGN KEY (source_version_id) REFERENCES act_source_record_versions(id) ON DELETE CASCADE,
  ADD CONSTRAINT act_archive_profile_import_sources_job_database_fk
    FOREIGN KEY (job_id, source_database_key)
    REFERENCES act_archive_profile_import_jobs(id, source_database_key),
  ADD CONSTRAINT act_archive_profile_import_sources_source_database_fk
    FOREIGN KEY (source_record_id, source_database_key)
    REFERENCES act_source_records(id, source_database_key),
  ADD CONSTRAINT act_archive_profile_import_sources_version_owner_fk
    FOREIGN KEY (source_version_id, source_record_id)
    REFERENCES act_source_record_versions(id, source_record_id),
  ADD CONSTRAINT act_archive_profile_import_sources_phase_valid
    CHECK (phase IN ('companies','contacts'));

CREATE INDEX act_archive_profile_import_sources_job_phase_source_idx
  ON act_archive_profile_import_sources (job_id, phase, source_record_id);

-- Profile links are normalized last, after the job and frozen membership
-- structures, matching the worker transaction's global lock order.
ALTER TABLE act_external_links
  DROP CONSTRAINT IF EXISTS act_external_links_contact_primary_sync_valid;

ALTER TABLE act_external_links
  ADD CONSTRAINT act_external_links_contact_primary_sync_valid CHECK (
    (
      entity_type = 'contact' AND source_entity_type = 'contact' AND (
        (is_primary = true AND sync_mode = 'two_way')
        OR (is_primary = false AND sync_mode = 'pull_only')
        OR (is_primary = true AND sync_mode = 'pull_only' AND source_database_key IS NOT NULL AND source_record_id IS NOT NULL)
      )
    )
    OR (entity_type <> 'contact' AND sync_mode = 'pull_only')
  );

DO $$
DECLARE
  constraint_row record;
  local_columns text[];
  referenced_columns text[];
BEGIN
  FOR constraint_row IN
    SELECT constraint_catalog.*
    FROM pg_constraint constraint_catalog
    WHERE constraint_catalog.conrelid = 'act_external_links'::regclass
      AND constraint_catalog.contype = 'f'
  LOOP
    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO local_columns
    FROM unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = key_column.attnum;

    SELECT array_agg(attribute.attname ORDER BY key_column.ordinality)
      INTO referenced_columns
    FROM unnest(constraint_row.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_row.confrelid
      AND attribute.attnum = key_column.attnum;

    IF constraint_row.conname = 'act_external_links_archive_source_scope_fk'
      OR (
        local_columns = ARRAY['source_record_id', 'source_database_key', 'source_entity_type']
        AND constraint_row.confrelid = 'act_source_records'::regclass
        AND referenced_columns = ARRAY['id', 'source_database_key', 'stream_type']
      )
    THEN
      EXECUTE format(
        'ALTER TABLE act_external_links DROP CONSTRAINT %I',
        constraint_row.conname
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE act_external_links
  ADD CONSTRAINT act_external_links_archive_source_scope_fk
  FOREIGN KEY (source_record_id, source_database_key, source_entity_type)
  REFERENCES act_source_records(id, source_database_key, stream_type);

-- Reconstruct only source/version pairs already evidenced by legacy results.
-- If 024 has already promoted a job to snapshot version 2, never touch its
-- frozen membership, even if newer sources now exist in the same database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'act_archive_profile_import_jobs'
      AND column_name = 'membership_snapshot_version'
  ) THEN
    INSERT INTO act_archive_profile_import_sources
      (job_id, source_database_key, source_record_id, source_version_id, phase)
    SELECT jobs.id, jobs.source_database_key, results.source_record_id,
      results.source_version_id,
      CASE source.stream_type WHEN 'company' THEN 'companies' ELSE 'contacts' END
    FROM act_archive_profile_import_jobs jobs
    JOIN act_archive_profile_import_results results ON results.job_id = jobs.id
    JOIN act_source_records source
      ON source.id = results.source_record_id
      AND source.source_database_key = jobs.source_database_key
    WHERE jobs.membership_snapshot_version IS NULL
      AND source.stream_type IN ('company', 'contact')
    ON CONFLICT (job_id, source_record_id) DO NOTHING;
  ELSE
    INSERT INTO act_archive_profile_import_sources
      (job_id, source_database_key, source_record_id, source_version_id, phase)
    SELECT jobs.id, jobs.source_database_key, results.source_record_id,
      results.source_version_id,
      CASE source.stream_type WHEN 'company' THEN 'companies' ELSE 'contacts' END
    FROM act_archive_profile_import_jobs jobs
    JOIN act_archive_profile_import_results results ON results.job_id = jobs.id
    JOIN act_source_records source
      ON source.id = results.source_record_id
      AND source.source_database_key = jobs.source_database_key
    WHERE source.stream_type IN ('company', 'contact')
    ON CONFLICT (job_id, source_record_id) DO NOTHING;
  END IF;
END $$;
