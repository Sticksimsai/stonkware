#!/usr/bin/env bash
# Nightly SQLite backup (safe while the app is running). Keeps 14 days locally.
# Optional off-site copy: set BACKUP_S3_URI (e.g. s3://my-space/firmware) and install+configure s3cmd for DigitalOcean Spaces.
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB=$(grep '^DATABASE_URL=' "$APP_DIR/.env" | sed -E 's/^DATABASE_URL="?file:([^"]*)"?/\1/')
case "$DB" in libsql:*|http*) echo "remote database (Turso) — nothing to back up locally"; exit 0;; esac
[ "${DB:0:1}" = "/" ] || DB="$APP_DIR/$DB"
OUT="$HOME/backups/firmware-$(date +%F-%H%M).db"
mkdir -p "$HOME/backups"
sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
find "$HOME/backups" -name 'firmware-*.db.gz' -mtime +14 -delete
echo "$(date -Is) backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
if [ -n "${BACKUP_S3_URI:-}" ] && command -v s3cmd >/dev/null; then
  s3cmd put "$OUT.gz" "$BACKUP_S3_URI/" --quiet && echo "uploaded to $BACKUP_S3_URI"
fi
