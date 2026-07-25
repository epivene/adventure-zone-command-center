#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <existing-backup-directory>\n' "${0##*/}" >&2
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
if [[ ! -d "$1" || -L "$1" ]]; then
  printf 'Backup target must be an existing, non-symlink directory.\n' >&2
  exit 64
fi

backup_directory="$(cd -- "$1" && pwd -P)"
if [[ "$backup_directory" == "/" ]]; then
  printf 'Refusing to use the filesystem root as a backup target.\n' >&2
  exit 64
fi

for required_command in pg_dump gpg mktemp date; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$required_command" >&2
    exit 69
  fi
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_path="$backup_directory/adventure-zone-$timestamp.dump.gpg"
if [[ -e "$backup_path" ]]; then
  printf 'Refusing to overwrite an existing backup.\n' >&2
  exit 73
fi

temporary_dump=""
backup_complete=0
cleanup() {
  if [[ -n "$temporary_dump" && -f "$temporary_dump" ]]; then
    rm -- "$temporary_dump"
  fi
  if [[ "$backup_complete" -eq 0 && -f "$backup_path" ]]; then
    rm -- "$backup_path"
  fi
}
trap cleanup EXIT

temporary_dump="$(
  mktemp "${TMPDIR:-/tmp}/adventure-zone-backup.XXXXXX.dump"
)"

pg_dump --format=custom --file "$temporary_dump" "$DATABASE_URL"
gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --symmetric \
  --cipher-algo AES256 \
  --output "$backup_path" \
  "$temporary_dump"

backup_complete=1
printf 'Encrypted backup created: %s\n' "$backup_path"
