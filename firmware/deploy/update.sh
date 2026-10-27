#!/usr/bin/env bash
# Deploy the latest code: pull, install, migrate, build, zero-downtime reload.
#   sudo -u firmware ~/app/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
"$(dirname "$0")/backup.sh" || true
git pull --ff-only
PORT="$(grep -E "^PORT=" .env | cut -d\" -f2 || true)"; export PORT="${PORT:-3000}"
npm ci
npm run -s premigrate
npm run db:push
npm run build
pm2 reload deploy/ecosystem.config.cjs --update-env
pm2 save
echo "✓ updated to $(git rev-parse --short HEAD)"
