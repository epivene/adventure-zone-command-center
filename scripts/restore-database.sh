#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <encrypted-backup-file>\n' "${0##*/}" >&2
  exit 64
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL must be set.\n' >&2
  exit 64
fi
if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  printf 'BACKUP_ENCRYPTION_PASSPHRASE must be set.\n' >&2
  exit 64
fi
required_restore_confirmation="I_CONFIRM_THIS_DATABASE_IS_DISPOSABLE"
if [[ "${CONFIRM_DISPOSABLE_DATABASE_RESTORE:-}" != "$required_restore_confirmation" ]]; then
  printf \
    'Restore refused. Set CONFIRM_DISPOSABLE_DATABASE_RESTORE exactly to %s for this disposable database restore.\n' \
    "$required_restore_confirmation" >&2
  exit 64
fi
if [[ ! -f "$1" || -L "$1" ]]; then
  printf 'Backup path must name an existing, non-symlink regular file.\n' >&2
  exit 66
fi

backup_directory="$(cd -- "$(dirname -- "$1")" && pwd -P)"
backup_path="$backup_directory/$(basename -- "$1")"

for required_command in gpg pg_restore mktemp; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$required_command" >&2
    exit 69
  fi
done

temporary_dump=""
cleanup() {
  if [[ -n "$temporary_dump" && -f "$temporary_dump" ]]; then
    rm -- "$temporary_dump"
  fi
}
trap cleanup EXIT

temporary_dump="$(
  mktemp "${TMPDIR:-/tmp}/adventure-zone-restore.XXXXXX.dump"
)"

gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --decrypt \
  --output "$temporary_dump" \
  "$backup_path"

pg_restore \
  --clean \
  --if-exists \
  --dbname "$DATABASE_URL" \
  "$temporary_dump"

printf 'Restore completed successfully from %s.\n' "$backup_path"
