#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$SCRIPT_DIR/lib.sh"

OPERATION=postgres_backup
BACKUP_DIR=${BACKUP_DIR:-/backups}
RETAIN_COUNT=${RETAIN_COUNT:-14}
RETAIN_DAYS=${RETAIN_DAYS:-30}
PGDATABASE=${PGDATABASE:-weyne}
PGPORT=${PGPORT:-5432}
lock_dir=''
working_dir=''
snapshot_pid=''

cleanup() {
  status=$?
  [ -z "$snapshot_pid" ] || { kill "$snapshot_pid" 2>/dev/null || true; wait "$snapshot_pid" 2>/dev/null || true; }
  remove_pgpass
  [ -z "$working_dir" ] || rm -rf -- "$working_dir"
  [ -z "$lock_dir" ] || rmdir "$lock_dir" 2>/dev/null || true
  if [ "$status" -ne 0 ]; then
    log_event "operation=$OPERATION status=failed exit_code=$status"
  fi
}
trap cleanup EXIT HUP INT TERM

require_command pg_dump
require_command psql
require_command sha256sum
require_variable PGHOST
require_variable PGUSER
validate_database_identifier "$PGDATABASE" || fail_event 'unsafe_source_database_name' 64
case "$RETAIN_COUNT" in ''|*[!0-9]*|0) fail_event 'invalid_RETAIN_COUNT' 64 ;; esac
case "$RETAIN_DAYS" in ''|*[!0-9]*) fail_event 'invalid_RETAIN_DAYS' 64 ;; esac

umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
lock_candidate=$BACKUP_DIR/.backup.lock
if ! mkdir "$lock_candidate" 2>/dev/null; then
  fail_event 'overlapping_job_lock_exists' 75
fi
lock_dir=$lock_candidate

configure_pgpass
created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)
created_at_epoch=$(date -u +%s)
identity_timestamp=$(date -u +%Y%m%dT%H%M%SZ)
random_suffix=$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
backup_id=weyne-$identity_timestamp-$random_suffix
working_dir=$BACKUP_DIR/.$backup_id.partial
final_dir=$BACKUP_DIR/$backup_id.backup
mkdir "$working_dir"

snapshot_file=$working_dir/snapshot.id
psql -X -qAt --dbname="$PGDATABASE" --set=ON_ERROR_STOP=1 > /dev/null <<SQL &
\\pset tuples_only on
\\pset format unaligned
\\o $snapshot_file
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot();
\\o /dev/null
SELECT pg_sleep(300);
SQL
snapshot_pid=$!

attempt=0
while [ ! -s "$snapshot_file" ] && kill -0 "$snapshot_pid" 2>/dev/null; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail_event 'snapshot_export_timeout' 70
  sleep 1
done
[ -s "$snapshot_file" ] || fail_event 'snapshot_export_failed' 70
snapshot=$(sed 's/[[:space:]]//g' "$snapshot_file")
case "$snapshot" in ''|*[!0-9A-Fa-f-]*) fail_event 'invalid_exported_snapshot' 70 ;; esac

log_event "operation=$OPERATION status=started backup_id=$backup_id created_at=$created_at_utc source_database=$PGDATABASE"
pg_dump --dbname="$PGDATABASE" --format=custom --compress=9 --no-owner --no-privileges \
  --snapshot="$snapshot" --file="$working_dir/database.dump"
capture_counts "$PGDATABASE" "$snapshot" "$working_dir/counts.tsv"
kill "$snapshot_pid" 2>/dev/null || true
wait "$snapshot_pid" 2>/dev/null || true
snapshot_pid=''
rm -f "$snapshot_file"

cat > "$working_dir/manifest.env" <<EOF
FORMAT_VERSION=1
BACKUP_ID=$backup_id
CREATED_AT_EPOCH=$created_at_epoch
CREATED_AT_UTC=$created_at_utc
SOURCE_DATABASE=$PGDATABASE
POSTGRES_DUMP_VERSION=$(pg_dump --version | tr ' ' '_')
STATUS=complete
EOF
(
  cd "$working_dir"
  sha256sum database.dump counts.tsv manifest.env > SHA256SUMS
)
chmod 600 "$working_dir"/*
mv "$working_dir" "$final_dir"
working_dir=''

"$SCRIPT_DIR/prune-backups.sh" "$BACKUP_DIR" "$RETAIN_COUNT" "$RETAIN_DAYS"
log_event "operation=$OPERATION status=succeeded backup_id=$backup_id created_at=$created_at_utc artifact=$final_dir"
