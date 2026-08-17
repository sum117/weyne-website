#!/bin/sh
set -eu

log_event() {
  printf '%s\n' "$*"
}

fail_event() {
  log_event "operation=${OPERATION:-postgres_backup} status=failed reason=$1"
  exit "${2:-1}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail_event "missing_command_$1" 69
}

require_variable() {
  variable_name=$1
  eval "variable_value=\${$variable_name:-}"
  [ -n "$variable_value" ] || fail_event "missing_$variable_name" 64
}

validate_database_identifier() {
  value=$1
  case "$value" in
    ''|*[!a-zA-Z0-9_]*) return 1 ;;
    *) [ "${#value}" -le 63 ] ;;
  esac
}

configure_pgpass() {
  require_variable PGHOST
  require_variable PGUSER
  require_variable PGPASS_SOURCE_FILE
  [ -f "$PGPASS_SOURCE_FILE" ] || fail_event 'password_file_not_found' 66

  pgpass_file=$(mktemp)
  chmod 600 "$pgpass_file"
  password=$(sed 's/[[:space:]]*$//' "$PGPASS_SOURCE_FILE")
  [ -n "$password" ] || fail_event 'password_file_empty' 64
  escaped_password=$(printf '%s' "$password" | sed 's/\\/\\\\/g; s/:/\\:/g')
  printf '%s:%s:*:%s:%s\n' "$PGHOST" "${PGPORT:-5432}" "$PGUSER" "$escaped_password" > "$pgpass_file"
  unset password escaped_password
  export PGPASSFILE=$pgpass_file
}

remove_pgpass() {
  [ -z "${pgpass_file:-}" ] || rm -f "$pgpass_file"
}

read_manifest() {
  manifest_file=$1
  BACKUP_ID=''
  CREATED_AT_EPOCH=''
  CREATED_AT_UTC=''
  SOURCE_DATABASE=''
  STATUS=''
  while IFS='=' read -r key value; do
    case "$key" in
      BACKUP_ID) BACKUP_ID=$value ;;
      CREATED_AT_EPOCH) CREATED_AT_EPOCH=$value ;;
      CREATED_AT_UTC) CREATED_AT_UTC=$value ;;
      SOURCE_DATABASE) SOURCE_DATABASE=$value ;;
      STATUS) STATUS=$value ;;
    esac
  done < "$manifest_file"
}

capture_counts() {
  database=$1
  snapshot=${2:-}
  output=$3
  table_list=$(mktemp)
  if [ -n "$snapshot" ]; then
    psql -X -qAt --dbname="$database" --set=ON_ERROR_STOP=1 --set=snapshot="$snapshot" > "$table_list" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot';
SELECT format('%I.%I', schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename;
COMMIT;
SQL
  else
    psql -X -qAt --dbname="$database" --set=ON_ERROR_STOP=1 > "$table_list" <<'SQL'
SELECT format('%I.%I', schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY schemaname, tablename;
SQL
  fi

  : > "$output"
  while IFS= read -r table_name; do
    [ -n "$table_name" ] || continue
    if [ -n "$snapshot" ]; then
      row_count=$(psql -X -qAt --dbname="$database" --set=ON_ERROR_STOP=1 --set=snapshot="$snapshot" --set=table_name="$table_name" <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET TRANSACTION SNAPSHOT :'snapshot';
SELECT count(*) FROM :table_name;
COMMIT;
SQL
)
    else
      row_count=$(psql -X -qAt --dbname="$database" --set=ON_ERROR_STOP=1 --set=table_name="$table_name" <<'SQL'
SELECT count(*) FROM :table_name;
SQL
)
    fi
    printf '%s\t%s\n' "$table_name" "$row_count" >> "$output"
  done < "$table_list"
  rm -f "$table_list"
}
