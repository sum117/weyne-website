#!/bin/sh
set -eu

failed_unit=${1:-weyne-postgres-backup.service}
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
message="Weyne PostgreSQL backup failed unit=$failed_unit timestamp=$timestamp; inspect journalctl -u $failed_unit"
printf '%s\n' "$message" >&2

if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  printf 'url = "%s"\nrequest = "POST"\nheader = "Content-Type: application/json"\ndata = "{\\"text\\":\\"%s\\"}"\nsilent\nshow-error\nfail\n' \
    "$ALERT_WEBHOOK_URL" "$message" | curl --config -
fi
