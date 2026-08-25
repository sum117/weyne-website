#!/bin/sh
set -eu

usage() {
  printf '%s\n' 'usage: prune-backups.sh [--dry-run] BACKUP_DIR RETAIN_COUNT RETAIN_DAYS' >&2
  exit 64
}

fail() {
  printf 'error=%s\n' "$1" >&2
  exit 64
}

dry_run=false
if [ "${1:-}" = '--dry-run' ]; then
  dry_run=true
  shift
fi

[ "$#" -eq 3 ] || usage
backup_dir=$1
retain_count=$2
retain_days=$3

case "$retain_count" in
  ''|*[!0-9]*|0) fail 'RETAIN_COUNT must be a positive integer' ;;
esac
case "$retain_days" in
  ''|*[!0-9]*) fail 'RETAIN_DAYS must be a non-negative integer' ;;
esac
[ -d "$backup_dir" ] || fail 'BACKUP_DIR must be an existing directory'

list_file=$(mktemp)
trap 'rm -f "$list_file"' EXIT HUP INT TERM

bundles=''
for bundle in "$backup_dir"/weyne-*.backup; do
  [ -d "$bundle" ] || continue
  [ -f "$bundle/manifest.env" ] || continue
  status=''
  while IFS='=' read -r key value; do
    [ "$key" = STATUS ] && status=$value
  done < "$bundle/manifest.env"
  [ "$status" = complete ] || continue
  bundles="$bundle
$bundles"
done
printf '%s' "$bundles" > "$list_file"

now_epoch=${NOW_EPOCH:-$(date +%s)}

rank=0
while IFS= read -r bundle; do
  [ -n "$bundle" ] || continue
  rank=$((rank + 1))
  reason=''
  created_at_epoch=''
  while IFS='=' read -r key value; do
    [ "$key" = CREATED_AT_EPOCH ] && created_at_epoch=$value
  done < "$bundle/manifest.env"
  case "$created_at_epoch" in
    ''|*[!0-9]*) fail "invalid CREATED_AT_EPOCH in $bundle/manifest.env" ;;
  esac
  if [ "$rank" -gt "$retain_count" ]; then
    reason=count
  fi
  if [ $((now_epoch - created_at_epoch)) -gt $((retain_days * 86400)) ]; then
    reason=${reason:+"$reason,"}age
  fi

  if [ -n "$reason" ]; then
    printf 'prune=%s reason=%s dry_run=%s\n' "$bundle" "$reason" "$dry_run"
    if [ "$dry_run" = false ]; then
      rm -rf -- "$bundle"
    fi
  else
    printf 'retain=%s rank=%s\n' "$bundle" "$rank"
  fi
done < "$list_file"
