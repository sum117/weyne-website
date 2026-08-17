#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

OPERATION=postgres_restore_drill
bundle=${1:-}
PGPORT=${PGPORT:-5432}
PGMAINTENANCE_DATABASE=${PGMAINTENANCE_DATABASE:-postgres}
RESTORE_DATABASE=${RESTORE_DATABASE:-weyne_restore_$(date -u +%Y%m%dT%H%M%SZ)}
KEEP_RESTORE_DATABASE=${KEEP_RESTORE_DATABASE:-false}
created_database=false
actual_counts=''

cleanup() {
  status=$?
  if [ "$created_database" = true ] && [ "$KEEP_RESTORE_DATABASE" != true ]; then
    dropdb --if-exists --force --maintenance-db="$PGMAINTENANCE_DATABASE" "$RESTORE_DATABASE" >/dev/null 2>&1 || true
  fi
  [ -z "$actual_counts" ] || rm -f "$actual_counts"
  remove_pgpass
  if [ "$status" -ne 0 ]; then
    log_event "operation=$OPERATION status=failed exit_code=$status"
  fi
}
trap cleanup EXIT HUP INT TERM

[ -n "$bundle" ] || fail_event 'missing_backup_bundle' 64
[ -d "$bundle" ] || fail_event 'backup_bundle_not_found' 66
for required_file in manifest.env database.dump counts.tsv SHA256SUMS; do
  [ -f "$bundle/$required_file" ] || fail_event "missing_$required_file" 66
done
read_manifest "$bundle/manifest.env"
[ "$STATUS" = complete ] || fail_event 'backup_not_complete' 65
case "$BACKUP_ID" in weyne-*) ;; *) fail_event 'invalid_backup_identity' 65 ;; esac
case "$BACKUP_ID" in *[!a-zA-Z0-9-]*) fail_event 'invalid_backup_identity' 65 ;; esac
validate_database_identifier "$SOURCE_DATABASE" || fail_event 'invalid_source_database' 65
validate_database_identifier "$RESTORE_DATABASE" || fail_event 'invalid_restore_database' 64
case "$RESTORE_DATABASE" in weyne_restore_*) ;; *) fail_event 'restore_database_requires_weyne_restore_prefix' 64 ;; esac
[ "$RESTORE_DATABASE" != "$SOURCE_DATABASE" ] || fail_event 'restore_database_matches_source' 64

require_command sha256sum
checksum_names=$(awk '{print $2}' "$bundle/SHA256SUMS")
[ "$checksum_names" = "database.dump
counts.tsv
manifest.env" ] || fail_event 'unsafe_checksum_manifest' 65
if ! (cd "$bundle" && sha256sum -c SHA256SUMS >/dev/null 2>&1); then
  log_event "backup_id=$BACKUP_ID verification=failed reason=checksum_mismatch"
  exit 65
fi

require_command psql
require_command pg_restore
require_command createdb
require_command dropdb
require_variable PGHOST
require_variable PGUSER
configure_pgpass

existing=$(psql -X -qAt --dbname="$PGMAINTENANCE_DATABASE" --set=ON_ERROR_STOP=1 \
  --set=database_name="$RESTORE_DATABASE" <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'database_name';
SQL
)
[ -z "$existing" ] || fail_event 'restore_database_already_exists' 73

log_event "operation=$OPERATION status=started backup_id=$BACKUP_ID backup_created_at=$CREATED_AT_UTC restore_database=$RESTORE_DATABASE"
createdb --maintenance-db="$PGMAINTENANCE_DATABASE" "$RESTORE_DATABASE"
created_database=true
pg_restore --exit-on-error --no-owner --no-privileges --dbname="$RESTORE_DATABASE" "$bundle/database.dump"
actual_counts=$(mktemp)
capture_counts "$RESTORE_DATABASE" '' "$actual_counts"

if ! cmp -s "$bundle/counts.tsv" "$actual_counts"; then
  log_event "backup_id=$BACKUP_ID verification=failed reason=row_count_mismatch"
  diff -u "$bundle/counts.tsv" "$actual_counts" || true
  exit 65
fi

table_count=$(wc -l < "$actual_counts" | tr -d ' ')
row_count=$(awk -F '\t' '{sum += $2} END {print sum + 0}' "$actual_counts")
log_event "operation=$OPERATION status=succeeded backup_id=$BACKUP_ID backup_created_at=$CREATED_AT_UTC restore_database=$RESTORE_DATABASE checksum=verified tables_verified=$table_count rows_verified=$row_count disposable_database_removed=$([ "$KEEP_RESTORE_DATABASE" = true ] && printf false || printf true)"
