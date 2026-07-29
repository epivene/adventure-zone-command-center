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
        'resources',
        'resources_pkey',
        'resources_code_unique',
        'resource_package_tags',
        'resource_package_tags_pkey',
        'resource_package_tags_resource_package_unique',
        'booking_resource_assignments',
        'booking_resource_assignments_pkey',
        'booking_resource_assignments_booking_resource_unique',
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
  ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 8 target tables, %s of 8 table types, and %s of 2 booking columns; the recorded schema is incomplete.\n' \
      "$target_table_count" \
      "$target_table_type_count" \
      "$booking_column_count" >&2
    printf '%s\n' \
      'Stop and use the reviewed database restore procedure. Do not recreate objects or rewrite migration metadata by hand.' >&2
    exit 65
  fi
fi

expected_unique_index_count=0
expected_constraint_count=0
if [[ "$migration_record_count" -eq 1 ]]; then
  expected_unique_index_count="$(
    scalar_query "
      WITH expected_indexes (index_name, table_name) AS (
        VALUES
          ('package_templates_pkey', 'package_templates'),
          ('package_templates_code_unique', 'package_templates'),
          ('booking_package_selections_pkey', 'booking_package_selections'),
          ('booking_package_selections_booking_package_unique', 'booking_package_selections'),
          ('booking_special_requests_pkey', 'booking_special_requests'),
          ('resources_pkey', 'resources'),
          ('resources_code_unique', 'resources'),
          ('resource_package_tags_pkey', 'resource_package_tags'),
          ('resource_package_tags_resource_package_unique', 'resource_package_tags'),
          ('booking_resource_assignments_pkey', 'booking_resource_assignments'),
          ('booking_resource_assignments_booking_resource_unique', 'booking_resource_assignments'),
          ('booking_resource_package_attributions_pkey', 'booking_resource_package_attributions'),
          ('booking_resource_package_attributions_assignment_package_unique', 'booking_resource_package_attributions'),
          ('resource_conflict_overrides_pkey', 'resource_conflict_overrides'),
          ('resource_conflict_overrides_booking_conflict_unique', 'resource_conflict_overrides')
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
      INNER JOIN expected_indexes
        ON expected_indexes.index_name = index_relation.relname
        AND expected_indexes.table_name = table_relation.relname
      WHERE index_namespace.nspname = 'public'
        AND table_namespace.nspname = 'public'
        AND index_relation.relkind = 'i'
        AND pg_index.indisunique
        AND pg_index.indisvalid
        AND pg_index.indisready;
    "
  )"
  expected_unique_index_count="$(
    normalize_count "$expected_unique_index_count"
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

  if [[ "$expected_unique_index_count" -ne 15 ]]; then
    printf \
      'Migration blocked: Drizzle records 0007 as applied, but found %s of 15 unique indexes attached to their expected tables.\n' \
      "$expected_unique_index_count" >&2
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
