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

count_query() {
  psql \
    --no-psqlrc \
    --set=ON_ERROR_STOP=1 \
    --tuples-only \
    --no-align \
    --dbname "$DATABASE_URL" \
    --command "$1"
}

normalize_count() {
  local value="${1//[[:space:]]/}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    printf 'Migration preflight received an invalid count from PostgreSQL.\n' >&2
    exit 70
  fi
  printf '%s' "$value"
}

duplicate_act_groups="$(
  count_query '
    SELECT count(*)
    FROM (
      SELECT entity_type, act_record_id
      FROM act_external_links
      GROUP BY entity_type, act_record_id
      HAVING count(*) > 1
    ) AS duplicate_act_identifiers;
  '
)"
duplicate_act_groups="$(normalize_count "$duplicate_act_groups")"

invalid_travel_legs="$(
  count_query '
    SELECT count(*)
    FROM travel_legs
    WHERE sort_order NOT BETWEEN 1 AND 4;
  '
)"
invalid_travel_legs="$(normalize_count "$invalid_travel_legs")"

preflight_failed=0

if [[ "$duplicate_act_groups" -ne 0 ]]; then
  printf \
    'Migration blocked: %s duplicate Act external-identifier group(s) would violate the new unique index.\n' \
    "$duplicate_act_groups" >&2
  printf '%s\n' \
    'Inspect with:' \
    'SELECT entity_type, act_record_id, count(*) AS link_count,' \
    '       array_agg(id ORDER BY created_at, id) AS link_ids' \
    'FROM act_external_links' \
    'GROUP BY entity_type, act_record_id' \
    'HAVING count(*) > 1' \
    'ORDER BY entity_type, act_record_id;' \
    'Do not delete or merge these rows automatically. Stop and use a separately reviewed data-remediation procedure.' >&2
  preflight_failed=1
fi

if [[ "$invalid_travel_legs" -ne 0 ]]; then
  printf \
    'Migration blocked: %s travel-leg row(s) with sort_order outside 1-4 would violate the new check constraint.\n' \
    "$invalid_travel_legs" >&2
  printf '%s\n' \
    'Inspect with:' \
    'SELECT id, name, color, sort_order' \
    'FROM travel_legs' \
    'WHERE sort_order NOT BETWEEN 1 AND 4' \
    'ORDER BY sort_order, id;' \
    'Do not rewrite or delete these rows automatically. Stop and use a separately reviewed data-remediation procedure.' >&2
  preflight_failed=1
fi

if [[ "$preflight_failed" -ne 0 ]]; then
  exit 65
fi

printf 'Migration preflight passed: no duplicate Act identifiers or out-of-range travel legs were found.\n'
