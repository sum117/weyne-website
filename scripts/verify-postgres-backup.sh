#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
run_id="weyne-backup-drill-${CI_JOB_ID:-$$}-$RANDOM"
network="$run_id-net"
database_container="$run_id-db"
backup_container="$run_id-backup"
restore_container="$run_id-restore"
lock_container="$run_id-lock"
workspace=$(mktemp -d)
backup_dir=$workspace/backups
credential_file=$workspace/postgres-credential

cleanup() {
  docker rm -f "$backup_container" "$restore_container" "$lock_container" "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$workspace"
}
trap cleanup EXIT

mkdir -p "$backup_dir"
printf '%s' 'unused-for-local-trust' > "$credential_file"
docker network create "$network" >/dev/null
docker run -d --name "$database_container" --network "$network" \
  -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=weyne \
  --health-cmd='pg_isready -U postgres -d weyne' --health-interval=1s \
  --health-timeout=2s --health-retries=30 postgres:17.6-alpine >/dev/null

for _attempt in $(seq 1 45); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$database_container")" = healthy ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$database_container")" = healthy ]

docker exec "$database_container" psql -v ON_ERROR_STOP=1 -U postgres -d weyne -c \
  "CREATE TABLE customers (id integer PRIMARY KEY, name text NOT NULL); INSERT INTO customers VALUES (1, 'Ana'), (2, 'Bruno'), (3, 'Carla'); CREATE TABLE quotes (id integer PRIMARY KEY, customer_id integer REFERENCES customers(id), total_cents integer NOT NULL); INSERT INTO quotes VALUES (10, 1, 12500), (11, 2, 9900);" >/dev/null

if command -v cygpath >/dev/null 2>&1; then
  scripts_path=$(cd "$repository_root/deploy/postgres" && pwd -W)
  backup_native=$(cygpath -w "$backup_dir" | tr '\\' '/')
  credential_native=$(cygpath -w "$credential_file" | tr '\\' '/')
else
  scripts_path=$repository_root/deploy/postgres
  backup_native=$backup_dir
  credential_native=$credential_file
fi

mkdir "$backup_dir/.backup.lock"
set +e
lock_output=$(docker run --name "$lock_container" --network "$network" \
  -e PGHOST="$database_container" -e PGUSER=postgres -e PGDATABASE=weyne \
  -e PGPASS_SOURCE_FILE=/run/secrets/postgres_credential -e BACKUP_DIR=/backups \
  -v "$scripts_path:/ops:ro" -v "$backup_native:/backups" \
  -v "$credential_native:/run/secrets/postgres_credential:ro" \
  postgres:17.6-alpine /bin/sh /ops/backup.sh 2>&1)
lock_status=$?
set -e
[ "$lock_status" -eq 75 ]
printf '%s\n' "$lock_output" | grep -q 'reason=overlapping_job_lock_exists'
rmdir "$backup_dir/.backup.lock"

docker run --name "$backup_container" --network "$network" \
  -e PGHOST="$database_container" -e PGUSER=postgres -e PGDATABASE=weyne \
  -e PGPASS_SOURCE_FILE=/run/secrets/postgres_credential -e BACKUP_DIR=/backups \
  -e RETAIN_COUNT=2 -e RETAIN_DAYS=30 \
  -v "$scripts_path:/ops:ro" -v "$backup_native:/backups" \
  -v "$credential_native:/run/secrets/postgres_credential:ro" \
  postgres:17.6-alpine /bin/sh /ops/backup.sh

bundle_name=$(find "$backup_dir" -maxdepth 1 -type d -name 'weyne-*.backup' -printf '%f\n')
[ -n "$bundle_name" ]
bundle=/backups/$bundle_name

docker run --name "$restore_container" --network "$network" \
  -e PGHOST="$database_container" -e PGUSER=postgres -e PGDATABASE=weyne \
  -e RESTORE_DATABASE=weyne_restore_acceptance \
  -e PGPASS_SOURCE_FILE=/run/secrets/postgres_credential \
  -v "$scripts_path:/ops:ro" -v "$backup_native:/backups:ro" \
  -v "$credential_native:/run/secrets/postgres_credential:ro" \
  postgres:17.6-alpine /bin/sh /ops/restore-drill.sh "$bundle"

cp -R "$backup_dir/$bundle_name" "$backup_dir/corrupt.backup"
printf 'corruption' >> "$backup_dir/corrupt.backup/database.dump"
set +e
corrupt_output=$(docker run --name "$run_id-corrupt" --network "$network" \
  -e PGHOST="$database_container" -e PGUSER=postgres \
  -e RESTORE_DATABASE=weyne_restore_corrupt \
  -e PGPASS_SOURCE_FILE=/run/secrets/postgres_credential \
  -v "$scripts_path:/ops:ro" -v "$backup_native:/backups:ro" \
  -v "$credential_native:/run/secrets/postgres_credential:ro" \
  postgres:17.6-alpine /bin/sh /ops/restore-drill.sh /backups/corrupt.backup 2>&1)
corrupt_status=$?
set -e
docker rm "$run_id-corrupt" >/dev/null
[ "$corrupt_status" -ne 0 ]
printf '%s\n' "$corrupt_output" | grep -q 'verification=failed reason=checksum_mismatch'

printf 'acceptance=passed backup_id=%s checksums=verified counts=verified overlap=visible_nonzero corrupt_backup=visible_nonzero\n' "${bundle_name%.backup}"
