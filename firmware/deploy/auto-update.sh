#!/usr/bin/env bash
# Auto-deploy: if main moved (e.g. the flagship agent's change was merged), pull, build and reload.
# If the new version doesn't come up healthy, roll back to the previous commit.
# Installed by cron every 5 minutes (see DEPLOY.md). Safe to run by hand.
set -uo pipefail
cd "$(dirname "$0")/.."
APP="$(pwd)"
LOG="${HOME}/logs/auto-update.log"
mkdir -p "$(dirname "$LOG")"
exec 9>"${HOME}/.auto-update.lock"
flock -n 9 || exit 0   # another run is in progress
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

BRANCH="${DEPLOY_BRANCH:-main}"
git fetch -q origin "$BRANCH" || { log "fetch failed"; exit 1; }
OLD="$(git rev-parse HEAD)"
NEW="$(git rev-parse "origin/$BRANCH")"
[ "$OLD" = "$NEW" ] && exit 0
# don't retry a commit that already failed; wait for the next fix on main
[ "$(git rev-parse -q --verify refs/firmware/failed 2>/dev/null)" = "$NEW" ] && exit 0

# only rebuild the backend when backend files changed (frontend changes deploy on Vercel)
REL="$(git rev-parse --show-prefix)"; REL="${REL%/}"
if [ -n "$REL" ] && git diff --quiet "$OLD" "$NEW" -- . ; then
  git merge -q --ff-only "origin/$BRANCH" && log "fast-forwarded to ${NEW:0:7} (no backend changes)"
  exit 0
fi

log "deploying ${OLD:0:7} → ${NEW:0:7}"
PORT="$(grep -E '^PORT=' .env | cut -d'"' -f2 || true)"; PORT="${PORT:-3000}"
healthy() { for _ in $(seq 1 "${HEALTH_TRIES:-12}"); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0; sleep 5; done; return 1; }

if "$APP/deploy/update.sh" >> "$LOG" 2>&1 && healthy; then
  log "✓ live at ${NEW:0:7}"
  exit 0
fi

log "✗ ${NEW:0:7} failed to build or start: rolling back to ${OLD:0:7}"
git reset -q --hard "$OLD"
npm ci >> "$LOG" 2>&1 && npm run build >> "$LOG" 2>&1 && pm2 reload deploy/ecosystem.config.cjs --update-env >> "$LOG" 2>&1
healthy && log "✓ rolled back, live at ${OLD:0:7}" || log "✗✗ rollback also unhealthy: check pm2 logs"
# stay on the old commit until main changes again (the failed commit is skipped next run)
git update-ref "refs/firmware/failed" "$NEW"
exit 1
