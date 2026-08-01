#!/usr/bin/env bash

set -Eeuo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL must be set.\n' >&2
  exit 64
fi
if ! command -v psql >/dev/null 2>&1; then
  printf 'Required command is unavailable: psql\n' >&2
  exit 69
fi

scalar_query() {
  psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --dbname "$DATABASE_URL" \
    --command "$1"
}

normalize_scalar() {
  local value="${1//[[:space:]]/}"
  if [[ -z "$value" ]]; then
    printf 'Migration preflight received an empty value from PostgreSQL.\n' >&2
    exit 70
  fi
  printf '%s' "$value"
}

normalize_count() {
  local value
  value="$(normalize_scalar "$1")"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    printf 'Migration preflight received an invalid count from PostgreSQL.\n' >&2
    exit 70
  fi
  printf '%s' "$value"
}

normalize_boolean() {
  local value
  value="$(normalize_scalar "$1")"
  if [[ "$value" != "t" && "$value" != "f" ]]; then
    printf 'Migration preflight received an invalid boolean from PostgreSQL.\n' >&2
    exit 70
  fi
  printf '%s' "$value"
}

drizzle_migration_table_exists="$(
  scalar_query "
    SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL;
  "
)"
drizzle_migration_table_exists="$(
  normalize_boolean "$drizzle_migration_table_exists"
)"

migration_record_count=0
if [[ "$drizzle_migration_table_exists" == "t" ]]; then
  migration_record_count="$(
    scalar_query "
      SELECT count(*)
      FROM drizzle.__drizzle_migrations
      WHERE created_at = 1785297094403;
    "
  )"
  migration_record_count="$(normalize_count "$migration_record_count")"
fi

target_relation_count="$(
  scalar_query "
    SELECT count(*)
    FROM pg_class
    INNER JOIN pg_namespace
      ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname IN (
        'package_templates',
        'package_templates_pkey',
        'package_templates_code_unique',
        'booking_package_selections',
        'booking_package_selections_pkey',
        'booking_package_selections_booking_package_unique',
        'booking_special_requests',
        'booking_special_requests_pkey',
        'booking_special_requests_booking_status_treatment_idx',
        'resources',
        'resources_pkey',
        'resources_code_unique',
        'resource_package_tags',
        'resource_package_tags_pkey',
        'resource_package_tags_resource_package_unique',
        'booking_resource_assignments',
        'booking_resource_assignments_pkey',
        'booking_resource_assignments_booking_resource_unique',
        'booking_resource_assignments_resource_id_idx',
        'booking_resource_package_attributions',
        'booking_resource_package_attributions_pkey',
        'booking_resource_package_attributions_assignment_package_unique',
        'resource_conflict_overrides',
        'resource_conflict_overrides_pkey',
        'resource_conflict_overrides_booking_conflict_unique'
      );
  "
)"
target_relation_count="$(normalize_count "$target_relation_count")"

target_table_type_count="$(
  scalar_query "
    SELECT count(*)
    FROM pg_type
    INNER JOIN pg_namespace
      ON pg_namespace.oid = pg_type.typnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_type.typname IN (
        'package_templates',
        'booking_package_selections',
        'booking_special_requests',
        'resources',
        'resource_package_tags',
        'booking_resource_assignments',
        'booking_resource_package_attributions',
        'resource_conflict_overrides'
      );
  "
)"
target_table_type_count="$(normalize_count "$target_table_type_count")"

target_table_count="$(
  scalar_query "
    SELECT count(*)
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'package_templates',
        'booking_package_selections',
        'booking_special_requests',
        'resources',
        'resource_package_tags',
        'booking_resource_assignments',
        'booking_resource_package_attributions',
        'resource_conflict_overrides'
      );
  "
)"
target_table_count="$(normalize_count "$target_table_count")"

booking_column_count="$(
  scalar_query "
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name IN (
        'physical_attraction_total',
        'attraction_total_approval_reason'
      );
  "
)"
booking_column_count="$(normalize_count "$booking_column_count")"

expected_column_definition_count="$(
  scalar_query "
    WITH expected_columns (
      table_name,
      column_name,
      data_type,
      is_nullable,
      has_default
    ) AS (
      VALUES
        ('bookings', 'physical_attraction_total', 'integer', 'YES', false),
        ('bookings', 'attraction_total_approval_reason', 'text', 'YES', false),
        ('package_templates', 'id', 'uuid', 'NO', true),
        ('package_templates', 'code', 'text', 'NO', false),
        ('package_templates', 'name', 'text', 'NO', false),
        ('package_templates', 'base_attraction_count', 'integer', 'NO', false),
        ('package_templates', 'active', 'boolean', 'NO', true),
        ('package_templates', 'created_at', 'timestamp with time zone', 'NO', true),
        ('package_templates', 'updated_at', 'timestamp with time zone', 'NO', true),
        ('booking_package_selections', 'id', 'uuid', 'NO', true),
        ('booking_package_selections', 'booking_id', 'uuid', 'NO', false),
        ('booking_package_selections', 'package_template_id', 'uuid', 'NO', false),
        ('booking_package_selections', 'created_at', 'timestamp with time zone', 'NO', true),
        ('booking_special_requests', 'id', 'uuid', 'NO', true),
        ('booking_special_requests', 'booking_id', 'uuid', 'NO', false),
        ('booking_special_requests', 'description', 'text', 'NO', false),
        ('booking_special_requests', 'treatment', 'text', 'NO', false),
        ('booking_special_requests', 'approval_status', 'text', 'NO', true),
        ('booking_special_requests', 'decision_reason', 'text', 'YES', false),
        ('booking_special_requests', 'decided_at', 'timestamp with time zone', 'YES', false),
        ('booking_special_requests', 'created_at', 'timestamp with time zone', 'NO', true),
        ('booking_special_requests', 'updated_at', 'timestamp with time zone', 'NO', true),
        ('resources', 'id', 'uuid', 'NO', true),
        ('resources', 'code', 'text', 'NO', false),
        ('resources', 'name', 'text', 'NO', false),
        ('resources', 'category', 'text', 'NO', false),
        ('resources', 'counts_as_attraction', 'boolean', 'NO', true),
        ('resources', 'movable', 'boolean', 'NO', true),
        ('resources', 'normal_travel_leg_id', 'uuid', 'YES', false),
        ('resources', 'setup_minutes', 'integer', 'NO', true),
        ('resources', 'teardown_minutes', 'integer', 'NO', true),
        ('resources', 'minimum_transfer_minutes', 'integer', 'NO', true),
        ('resources', 'status', 'text', 'NO', true),
        ('resources', 'created_at', 'timestamp with time zone', 'NO', true),
        ('resources', 'updated_at', 'timestamp with time zone', 'NO', true),
        ('resource_package_tags', 'id', 'uuid', 'NO', true),
        ('resource_package_tags', 'resource_id', 'uuid', 'NO', false),
        ('resource_package_tags', 'package_template_id', 'uuid', 'NO', false),
        ('resource_package_tags', 'created_at', 'timestamp with time zone', 'NO', true),
        ('booking_resource_assignments', 'id', 'uuid', 'NO', true),
        ('booking_resource_assignments', 'booking_id', 'uuid', 'NO', false),
        ('booking_resource_assignments', 'resource_id', 'uuid', 'NO', false),
        ('booking_resource_assignments', 'attribution_source', 'text', 'NO', true),
        ('booking_resource_assignments', 'created_at', 'timestamp with time zone', 'NO', true),
        ('booking_resource_assignments', 'updated_at', 'timestamp with time zone', 'NO', true),
        ('booking_resource_package_attributions', 'id', 'uuid', 'NO', true),
        ('booking_resource_package_attributions', 'booking_resource_assignment_id', 'uuid', 'NO', false),
        ('booking_resource_package_attributions', 'package_template_id', 'uuid', 'NO', false),
        ('booking_resource_package_attributions', 'created_at', 'timestamp with time zone', 'NO', true),
        ('resource_conflict_overrides', 'id', 'uuid', 'NO', true),
        ('resource_conflict_overrides', 'booking_id', 'uuid', 'NO', false),
        ('resource_conflict_overrides', 'resource_id', 'uuid', 'YES', false),
        ('resource_conflict_overrides', 'conflict_key', 'text', 'NO', false),
        ('resource_conflict_overrides', 'reason', 'text', 'NO', false),
        ('resource_conflict_overrides', 'acknowledged_by', 'text', 'NO', false),
        ('resource_conflict_overrides', 'created_at', 'timestamp with time zone', 'NO', true)
    )
    SELECT count(*)
    FROM information_schema.columns
    INNER JOIN expected_columns
      ON expected_columns.table_name =
        information_schema.columns.table_name
      AND expected_columns.column_name =
        information_schema.columns.column_name
      AND expected_columns.data_type =
        information_schema.columns.data_type
      AND expected_columns.is_nullable =
        information_schema.columns.is_nullable
      AND expected_columns.has_default =
        (information_schema.columns.column_default IS NOT NULL)
    WHERE information_schema.columns.table_schema = 'public';
  "
)"
expected_column_definition_count="$(
  normalize_count "$expected_column_definition_count"
)"

booking_constraint_collision_count="$(
  scalar_query "
    SELECT count(*)
    FROM pg_constraint
    INNER JOIN pg_class
      ON pg_class.oid = pg_constraint.conrelid
    INNER JOIN pg_namespace
      ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'bookings'
      AND pg_constraint.conname =
        'bookings_physical_attraction_total_nonnegative';
  "
)"
booking_constraint_collision_count="$(
  normalize_count "$booking_constraint_collision_count"
)"

if [[ "$migration_record_count" -gt 1 ]]; then
  printf \
    'Migration blocked: Drizzle metadata contains %s records for 0007_packages_resources; exactly zero or one is valid.\n' \
    "$migration_record_count" >&2
  printf '%s\n' \
    'Stop and inspect drizzle.__drizzle_migrations with the database administrator. Do not delete migration metadata automatically.' >&2
  exit 65
fi

if [[ "$migration_record_count" -eq 0 ]]; then
  if [[
    "$target_relation_count" -ne 0
    || "$target_table_type_count" -ne 0
    || "$booking_column_count" -ne 0
    || "$booking_constraint_collision_count" -ne 0
  ]]; then
    printf \
      'Migration blocked: 0007 is not recorded as applied, but %s target relation(s), %s target table type(s), %s new booking column(s), and %s booking constraint collision(s) already exist; this is a partial migration or schema collision.\n' \
      "$target_relation_count" \
      "$target_table_type_count" \
      "$booking_column_count" \
      "$booking_constraint_collision_count" >&2
    printf '%s\n' \
      'Do not drop or rename the colliding objects and do not insert migration metadata manually.' \
      'Stop and use the reviewed database restore procedure to return to the verified pre-migration backup, or obtain a separately reviewed data-remediation plan.' >&2
    exit 65
  fi
else
  if [[
    "$target_table_count" -ne 8
    || "$target_table_type_count" -ne 8
    || "$booking_column_count" -ne 2
    || "$expected_column_definition_count" -ne 56
  ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 8 target tables, %s of 8 table types, %s of 2 booking columns, and %s of 56 column definitions with their expected type, nullability, and default presence; the recorded schema is incomplete.\n' \
      "$target_table_count" \
      "$target_table_type_count" \
      "$booking_column_count" \
      "$expected_column_definition_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate objects or rewrite migration metadata by hand.' >&2
    exit 65
  fi
fi

expected_index_definition_count=0
expected_constraint_count=0
expected_foreign_key_definition_count=0
expected_check_definition_count=0
if [[ "$migration_record_count" -eq 1 ]]; then
  expected_index_definition_count="$(
    scalar_query "
      WITH expected_indexes (
        index_name,
        table_name,
        is_unique,
        column_names,
        access_method
      ) AS (
        VALUES
          ('package_templates_pkey', 'package_templates', true, ARRAY['id'], 'btree'),
          ('package_templates_code_unique', 'package_templates', true, ARRAY['code'], 'btree'),
          ('booking_package_selections_pkey', 'booking_package_selections', true, ARRAY['id'], 'btree'),
          ('booking_package_selections_booking_package_unique', 'booking_package_selections', true, ARRAY['booking_id', 'package_template_id'], 'btree'),
          ('booking_special_requests_pkey', 'booking_special_requests', true, ARRAY['id'], 'btree'),
          ('booking_special_requests_booking_status_treatment_idx', 'booking_special_requests', false, ARRAY['booking_id', 'approval_status', 'treatment'], 'btree'),
          ('resources_pkey', 'resources', true, ARRAY['id'], 'btree'),
          ('resources_code_unique', 'resources', true, ARRAY['code'], 'btree'),
          ('resource_package_tags_pkey', 'resource_package_tags', true, ARRAY['id'], 'btree'),
          ('resource_package_tags_resource_package_unique', 'resource_package_tags', true, ARRAY['resource_id', 'package_template_id'], 'btree'),
          ('booking_resource_assignments_pkey', 'booking_resource_assignments', true, ARRAY['id'], 'btree'),
          ('booking_resource_assignments_booking_resource_unique', 'booking_resource_assignments', true, ARRAY['booking_id', 'resource_id'], 'btree'),
          ('booking_resource_assignments_resource_id_idx', 'booking_resource_assignments', false, ARRAY['resource_id'], 'btree'),
          ('booking_resource_package_attributions_pkey', 'booking_resource_package_attributions', true, ARRAY['id'], 'btree'),
          ('booking_resource_package_attributions_assignment_package_unique', 'booking_resource_package_attributions', true, ARRAY['booking_resource_assignment_id', 'package_template_id'], 'btree'),
          ('resource_conflict_overrides_pkey', 'resource_conflict_overrides', true, ARRAY['id'], 'btree'),
          ('resource_conflict_overrides_booking_conflict_unique', 'resource_conflict_overrides', true, ARRAY['booking_id', 'conflict_key'], 'btree')
      )
      SELECT count(*)
      FROM pg_index
      INNER JOIN pg_class AS index_relation
        ON index_relation.oid = pg_index.indexrelid
      INNER JOIN pg_namespace AS index_namespace
        ON index_namespace.oid = index_relation.relnamespace
      INNER JOIN pg_class AS table_relation
        ON table_relation.oid = pg_index.indrelid
      INNER JOIN pg_namespace AS table_namespace
        ON table_namespace.oid = table_relation.relnamespace
      INNER JOIN pg_am
        ON pg_am.oid = index_relation.relam
      INNER JOIN expected_indexes
        ON expected_indexes.index_name = index_relation.relname
        AND expected_indexes.table_name = table_relation.relname
      WHERE index_namespace.nspname = 'public'
        AND table_namespace.nspname = 'public'
        AND index_relation.relkind = 'i'
        AND pg_index.indisunique = expected_indexes.is_unique
        AND pg_index.indisvalid
        AND pg_index.indisready
        AND pg_index.indpred IS NULL
        AND pg_index.indexprs IS NULL
        AND pg_am.amname = expected_indexes.access_method
        AND (
          SELECT array_agg(
            attribute.attname::text
            ORDER BY key.ordinality
          )
          FROM unnest(pg_index.indkey)
            WITH ORDINALITY AS key(attribute_number, ordinality)
          INNER JOIN pg_attribute AS attribute
            ON attribute.attrelid = pg_index.indrelid
            AND attribute.attnum = key.attribute_number
          WHERE key.ordinality <= pg_index.indnkeyatts
        ) = expected_indexes.column_names;
    "
  )"
  expected_index_definition_count="$(
    normalize_count "$expected_index_definition_count"
  )"

  expected_constraint_count="$(
    scalar_query "
      WITH expected_constraints (
        table_name,
        constraint_name,
        constraint_type
      ) AS (
        VALUES
          ('package_templates', 'package_templates_pkey', 'p'),
          ('booking_package_selections', 'booking_package_selections_pkey', 'p'),
          ('booking_resource_assignments', 'booking_resource_assignments_pkey', 'p'),
          ('booking_resource_package_attributions', 'booking_resource_package_attributions_pkey', 'p'),
          ('booking_special_requests', 'booking_special_requests_pkey', 'p'),
          ('resources', 'resources_pkey', 'p'),
          ('resource_package_tags', 'resource_package_tags_pkey', 'p'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_pkey', 'p'),
          ('booking_package_selections', 'booking_package_selections_booking_id_bookings_id_fk', 'f'),
          ('booking_package_selections', 'booking_package_selections_package_template_id_package_templates_id_fk', 'f'),
          ('booking_resource_assignments', 'booking_resource_assignments_booking_id_bookings_id_fk', 'f'),
          ('booking_resource_assignments', 'booking_resource_assignments_resource_id_resources_id_fk', 'f'),
          ('booking_resource_package_attributions', 'booking_resource_package_attributions_booking_resource_assignment_id_booking_resource_assignments_id_fk', 'f'),
          ('booking_resource_package_attributions', 'booking_resource_package_attributions_package_template_id_package_templates_id_fk', 'f'),
          ('booking_special_requests', 'booking_special_requests_booking_id_bookings_id_fk', 'f'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_booking_id_bookings_id_fk', 'f'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_resource_id_resources_id_fk', 'f'),
          ('resource_package_tags', 'resource_package_tags_resource_id_resources_id_fk', 'f'),
          ('resource_package_tags', 'resource_package_tags_package_template_id_package_templates_id_fk', 'f'),
          ('resources', 'resources_normal_travel_leg_id_travel_legs_id_fk', 'f'),
          ('bookings', 'bookings_physical_attraction_total_nonnegative', 'c'),
          ('booking_resource_assignments', 'booking_resource_assignments_attribution_source_valid', 'c'),
          ('booking_special_requests', 'booking_special_requests_description_nonblank', 'c'),
          ('booking_special_requests', 'booking_special_requests_treatment_valid', 'c'),
          ('booking_special_requests', 'booking_special_requests_approval_status_valid', 'c'),
          ('package_templates', 'package_templates_code_nonblank', 'c'),
          ('package_templates', 'package_templates_name_nonblank', 'c'),
          ('package_templates', 'package_templates_base_attraction_count_positive', 'c'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_conflict_key_nonblank', 'c'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_reason_nonblank', 'c'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_acknowledged_by_nonblank', 'c'),
          ('resources', 'resources_code_nonblank', 'c'),
          ('resources', 'resources_name_nonblank', 'c'),
          ('resources', 'resources_category_nonblank', 'c'),
          ('resources', 'resources_status_valid', 'c'),
          ('resources', 'resources_setup_minutes_nonnegative', 'c'),
          ('resources', 'resources_teardown_minutes_nonnegative', 'c'),
          ('resources', 'resources_minimum_transfer_minutes_nonnegative', 'c')
      )
      SELECT count(*)
      FROM pg_constraint
      INNER JOIN pg_class
        ON pg_class.oid = pg_constraint.conrelid
      INNER JOIN pg_namespace
        ON pg_namespace.oid = pg_class.relnamespace
      INNER JOIN expected_constraints
        ON expected_constraints.table_name = pg_class.relname
        AND pg_constraint.conname::text =
          left(expected_constraints.constraint_name, 63)
        AND expected_constraints.constraint_type = pg_constraint.contype::text
      WHERE pg_namespace.nspname = 'public';
    "
  )"
  expected_constraint_count="$(normalize_count "$expected_constraint_count")"

  expected_foreign_key_definition_count="$(
    scalar_query "
      WITH expected_foreign_keys (
        table_name,
        constraint_name,
        source_columns,
        target_table_name,
        target_columns,
        delete_action,
        update_action
      ) AS (
        VALUES
          ('booking_package_selections', 'booking_package_selections_booking_id_bookings_id_fk', ARRAY['booking_id'], 'bookings', ARRAY['id'], 'c', 'a'),
          ('booking_package_selections', 'booking_package_selections_package_template_id_package_templates_id_fk', ARRAY['package_template_id'], 'package_templates', ARRAY['id'], 'a', 'a'),
          ('booking_resource_assignments', 'booking_resource_assignments_booking_id_bookings_id_fk', ARRAY['booking_id'], 'bookings', ARRAY['id'], 'c', 'a'),
          ('booking_resource_assignments', 'booking_resource_assignments_resource_id_resources_id_fk', ARRAY['resource_id'], 'resources', ARRAY['id'], 'a', 'a'),
          ('booking_resource_package_attributions', 'booking_resource_package_attributions_booking_resource_assignment_id_booking_resource_assignments_id_fk', ARRAY['booking_resource_assignment_id'], 'booking_resource_assignments', ARRAY['id'], 'c', 'a'),
          ('booking_resource_package_attributions', 'booking_resource_package_attributions_package_template_id_package_templates_id_fk', ARRAY['package_template_id'], 'package_templates', ARRAY['id'], 'a', 'a'),
          ('booking_special_requests', 'booking_special_requests_booking_id_bookings_id_fk', ARRAY['booking_id'], 'bookings', ARRAY['id'], 'c', 'a'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_booking_id_bookings_id_fk', ARRAY['booking_id'], 'bookings', ARRAY['id'], 'c', 'a'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_resource_id_resources_id_fk', ARRAY['resource_id'], 'resources', ARRAY['id'], 'a', 'a'),
          ('resource_package_tags', 'resource_package_tags_resource_id_resources_id_fk', ARRAY['resource_id'], 'resources', ARRAY['id'], 'c', 'a'),
          ('resource_package_tags', 'resource_package_tags_package_template_id_package_templates_id_fk', ARRAY['package_template_id'], 'package_templates', ARRAY['id'], 'c', 'a'),
          ('resources', 'resources_normal_travel_leg_id_travel_legs_id_fk', ARRAY['normal_travel_leg_id'], 'travel_legs', ARRAY['id'], 'a', 'a')
      )
      SELECT count(*)
      FROM pg_constraint
      INNER JOIN pg_class AS source_relation
        ON source_relation.oid = pg_constraint.conrelid
      INNER JOIN pg_namespace AS source_namespace
        ON source_namespace.oid = source_relation.relnamespace
      INNER JOIN pg_class AS target_relation
        ON target_relation.oid = pg_constraint.confrelid
      INNER JOIN pg_namespace AS target_namespace
        ON target_namespace.oid = target_relation.relnamespace
      INNER JOIN expected_foreign_keys
        ON expected_foreign_keys.table_name = source_relation.relname
        AND pg_constraint.conname::text =
          left(expected_foreign_keys.constraint_name, 63)
        AND expected_foreign_keys.target_table_name = target_relation.relname
        AND expected_foreign_keys.delete_action =
          pg_constraint.confdeltype::text
        AND expected_foreign_keys.update_action =
          pg_constraint.confupdtype::text
        AND (
          SELECT array_agg(attribute.attname ORDER BY key.ordinality)
          FROM unnest(pg_constraint.conkey)
            WITH ORDINALITY AS key(attribute_number, ordinality)
          INNER JOIN pg_attribute AS attribute
            ON attribute.attrelid = pg_constraint.conrelid
            AND attribute.attnum = key.attribute_number
        ) = expected_foreign_keys.source_columns
        AND (
          SELECT array_agg(attribute.attname ORDER BY key.ordinality)
          FROM unnest(pg_constraint.confkey)
            WITH ORDINALITY AS key(attribute_number, ordinality)
          INNER JOIN pg_attribute AS attribute
            ON attribute.attrelid = pg_constraint.confrelid
            AND attribute.attnum = key.attribute_number
        ) = expected_foreign_keys.target_columns
      WHERE source_namespace.nspname = 'public'
        AND target_namespace.nspname = 'public'
        AND pg_constraint.contype = 'f'
        AND pg_constraint.convalidated;
    "
  )"
  expected_foreign_key_definition_count="$(
    normalize_count "$expected_foreign_key_definition_count"
  )"

  expected_check_definition_count="$(
    scalar_query "
      WITH expected_checks (
        table_name,
        constraint_name,
        normalized_expression
      ) AS (
        VALUES
          ('bookings', 'bookings_physical_attraction_total_nonnegative', 'physical_attraction_totalisnullorphysical_attraction_total>=0'),
          ('booking_resource_assignments', 'booking_resource_assignments_attribution_source_valid', 'attribution_source=any(array[''inferred''::text,''manual''::text])'),
          ('booking_special_requests', 'booking_special_requests_description_nonblank', 'nullif(trim(bothfromdescription),''''::text)isnotnull'),
          ('booking_special_requests', 'booking_special_requests_treatment_valid', 'treatment=any(array[''add_to_count''::text,''replace_included''::text,''note_only''::text])'),
          ('booking_special_requests', 'booking_special_requests_approval_status_valid', 'approval_status=any(array[''needs_approval''::text,''approved''::text,''declined''::text])'),
          ('package_templates', 'package_templates_code_nonblank', 'nullif(trim(bothfromcode),''''::text)isnotnull'),
          ('package_templates', 'package_templates_name_nonblank', 'nullif(trim(bothfromname),''''::text)isnotnull'),
          ('package_templates', 'package_templates_base_attraction_count_positive', 'base_attraction_count>0'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_conflict_key_nonblank', 'nullif(trim(bothfromconflict_key),''''::text)isnotnull'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_reason_nonblank', 'nullif(trim(bothfromreason),''''::text)isnotnull'),
          ('resource_conflict_overrides', 'resource_conflict_overrides_acknowledged_by_nonblank', 'nullif(trim(bothfromacknowledged_by),''''::text)isnotnull'),
          ('resources', 'resources_code_nonblank', 'nullif(trim(bothfromcode),''''::text)isnotnull'),
          ('resources', 'resources_name_nonblank', 'nullif(trim(bothfromname),''''::text)isnotnull'),
          ('resources', 'resources_category_nonblank', 'nullif(trim(bothfromcategory),''''::text)isnotnull'),
          ('resources', 'resources_status_valid', 'status=any(array[''available''::text,''unavailable''::text,''maintenance''::text,''archived''::text])'),
          ('resources', 'resources_setup_minutes_nonnegative', 'setup_minutes>=0'),
          ('resources', 'resources_teardown_minutes_nonnegative', 'teardown_minutes>=0'),
          ('resources', 'resources_minimum_transfer_minutes_nonnegative', 'minimum_transfer_minutes>=0')
      )
      SELECT count(*)
      FROM pg_constraint
      INNER JOIN pg_class
        ON pg_class.oid = pg_constraint.conrelid
      INNER JOIN pg_namespace
        ON pg_namespace.oid = pg_class.relnamespace
      INNER JOIN expected_checks
        ON expected_checks.table_name = pg_class.relname
        AND pg_constraint.conname::text =
          left(expected_checks.constraint_name, 63)
      WHERE pg_namespace.nspname = 'public'
        AND pg_constraint.contype = 'c'
        AND pg_constraint.convalidated
        AND regexp_replace(
          lower(pg_get_expr(
            pg_constraint.conbin,
            pg_constraint.conrelid,
            true
          )),
          '[[:space:]\"]',
          '',
          'g'
        ) = expected_checks.normalized_expression;
    "
  )"
  expected_check_definition_count="$(
    normalize_count "$expected_check_definition_count"
  )"

  if [[ "$expected_index_definition_count" -ne 17 ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 17 index definitions with their expected table, uniqueness, validity, readiness, and ordered columns.\n' \
      "$expected_index_definition_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate indexes or rewrite migration metadata by hand.' >&2
    exit 65
  fi

  if [[ "$expected_constraint_count" -ne 38 ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 38 constraints with their expected table/name/type.\n' \
      "$expected_constraint_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate constraints or rewrite migration metadata by hand.' >&2
    exit 65
  fi

  if [[ "$expected_foreign_key_definition_count" -ne 12 ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 12 foreign-key definitions with their expected source columns, target columns, target tables, and update/delete actions.\n' \
      "$expected_foreign_key_definition_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate constraints or rewrite migration metadata by hand.' >&2
    exit 65
  fi

  if [[ "$expected_check_definition_count" -ne 18 ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 18 check definitions with their expected validated expressions.\n' \
      "$expected_check_definition_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate constraints or rewrite migration metadata by hand.' >&2
    exit 65
  fi
fi

incompatible_packages=0
incompatible_resources=0
if [[ "$migration_record_count" -eq 1 ]]; then
  incompatible_packages="$(
    scalar_query "
      SELECT count(*)
      FROM package_templates
      WHERE code IN (
        'adventure_zone',
        'weekend_warriors',
        'pirates_rebellion'
      )
        AND (name, base_attraction_count) IS DISTINCT FROM (
          CASE code
            WHEN 'adventure_zone' THEN 'Adventure Zone'
            WHEN 'weekend_warriors' THEN 'Weekend Warriors'
            WHEN 'pirates_rebellion' THEN 'Pirates Rebellion'
          END,
          CASE code
            WHEN 'adventure_zone' THEN 10
            WHEN 'weekend_warriors' THEN 5
            WHEN 'pirates_rebellion' THEN 3
          END
        );
    "
  )"
  incompatible_packages="$(normalize_count "$incompatible_packages")"

  incompatible_resources="$(
    scalar_query "
      SELECT count(*)
      FROM resources
      WHERE code = 'paintball_trailer'
        AND (name, category, counts_as_attraction, movable) IS DISTINCT FROM (
          'Paintball trailer',
          'trailer',
          true,
          true
        );
    "
  )"
  incompatible_resources="$(normalize_count "$incompatible_resources")"
fi

preflight_failed=0

if [[ "$incompatible_packages" -ne 0 ]]; then
  printf \
    'Migration blocked: %s stable package code row(s) have incompatible names or base counts.\n' \
    "$incompatible_packages" >&2
  printf '%s\n' \
    'Inspect with:' \
    "SELECT id, code, name, base_attraction_count, active" \
    "FROM package_templates" \
    "WHERE code IN ('adventure_zone', 'weekend_warriors', 'pirates_rebellion')" \
    'ORDER BY code;' \
    'Do not overwrite, rename, or delete these rows automatically. Stop and use a separately reviewed data-remediation procedure.' >&2
  preflight_failed=1
fi

if [[ "$incompatible_resources" -ne 0 ]]; then
  printf \
    'Migration blocked: %s stable resource code row(s) are incompatible with the movable counted-once paintball trailer.\n' \
    "$incompatible_resources" >&2
  printf '%s\n' \
    'Inspect with:' \
    "SELECT id, code, name, category, counts_as_attraction, movable, status" \
    "FROM resources" \
    "WHERE code = 'paintball_trailer';" \
    'Do not overwrite, rename, or delete this row automatically. Stop and use a separately reviewed data-remediation procedure.' >&2
  preflight_failed=1
fi

if [[ "$preflight_failed" -ne 0 ]]; then
  exit 65
fi

printf 'Daily-operations migration preflight passed: the 0007 schema state is safe and no incompatible stable package or resource codes were found.\n'
