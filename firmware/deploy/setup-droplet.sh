#!/usr/bin/env bash
# Stonkware backend — one-shot setup for a fresh Ubuntu 24.04 DigitalOcean droplet.
#
#   ssh root@YOUR_DROPLET_IP
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/deploy/setup-droplet.sh -o setup.sh
#   DOMAIN=api.firmware.xyz REPO=https://github.com/<you>/<repo>.git EMAIL=you@example.com bash setup.sh
#
# Options (env vars):
#   DOMAIN        public hostname for the API (DNS A record must point at this droplet)   [required]
#   REPO          git URL of this repo (use a deploy key / token URL for private repos)    [required]
#   EMAIL         email for Let's Encrypt certificates                                      [required]
#   BRANCH        git branch                                                     (default: main)
#   LOCAL_BROWSER 1 = install headless Chromium for the agents (if not using Browserbase) (default: 1)
#   FRONTEND      your frontend origin(s), comma-separated (added to ALLOWED_ORIGINS)
#   SITES_DOMAIN  company sites get <ticker>.SITES_DOMAIN (default: DOMAIN minus "api.", needs a wildcard DNS record)
#   REPO_SUBDIR   backend folder inside a monorepo                               (default: firmware)
#   PORT          local port for the app (default: 3000, or 3100 if 3000 is taken)
#   UPGRADE       0 = skip "apt-get upgrade" (recommended on a server shared with other projects) (default: 1)
#
# Safe on a droplet that already runs other projects: it never resets the firewall, keeps an
# existing Node >= 20, and plugs into an existing nginx or Caddy instead of replacing it.
set -euo pipefail

: "${DOMAIN:?set DOMAIN=api.yourdomain.com}"
: "${REPO:?set REPO=https://github.com/you/firmware.git}"
: "${EMAIL:?set EMAIL=you@example.com}"
BRANCH="${BRANCH:-main}"
LOCAL_BROWSER="${LOCAL_BROWSER:-1}"
FRONTEND="${FRONTEND:-}"
SITES_DOMAIN="${SITES_DOMAIN:-${DOMAIN#api.}}"
[ "$SITES_DOMAIN" = "$DOMAIN" ] && SITES_DOMAIN=""
PORT="${PORT:-}"
if [ -z "$PORT" ]; then
  if ss -tln | grep -q ':3000 '; then PORT=3100; else PORT=3000; fi
fi
ss -tln | grep -q ":$PORT " && { echo "port $PORT is already in use — set PORT=<free port>"; exit 1; }
APP_USER=firmware
APP_DIR=/home/$APP_USER/app

log() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

log "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
if [ "${UPGRADE:-1}" = "1" ]; then apt-get upgrade -y; else echo "skipping apt-get upgrade (UPGRADE=0)"; fi
apt-get install -y curl git ufw fail2ban sqlite3 unattended-upgrades ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https
dpkg-reconfigure -f noninteractive unattended-upgrades

log "Swap (helps small droplets build Next.js and run Chromium)"
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "Firewall"
if ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp && ufw allow 443/tcp      # add rules only; existing rules untouched
else
  echo "ufw is inactive — leaving it as is so other projects keep working."
  echo "(The app listens on 127.0.0.1:$PORT only, so it isn't exposed either way.)"
fi

log "App user"
id -u $APP_USER >/dev/null 2>&1 || adduser --disabled-password --gecos "" $APP_USER
if [ -f /root/.ssh/authorized_keys ]; then
  mkdir -p /home/$APP_USER/.ssh && cp /root/.ssh/authorized_keys /home/$APP_USER/.ssh/ && chown -R $APP_USER:$APP_USER /home/$APP_USER/.ssh && chmod 700 /home/$APP_USER/.ssh
fi

log "Node.js + pm2"
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$NODE_MAJOR" -lt 20 ]; then
    echo "Node $(node -v) is installed (another project may rely on it). Stonkware needs Node >= 20."
    echo "Upgrade it (curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs) and re-run."
    exit 1
  fi
  echo "keeping existing Node $(node -v)"
fi
command -v pm2 >/dev/null || npm install -g pm2@latest


log "Code"
# Works for a repo that IS the backend, or a monorepo with the backend in ./firmware
REPO_DIR=/home/$APP_USER/repo
if [ -e "$APP_DIR/package.json" ]; then
  sudo -H -u $APP_USER git -C "$APP_DIR" pull --ff-only
else
  [ -d "$REPO_DIR/.git" ] || sudo -H -u $APP_USER git clone --branch "$BRANCH" "$REPO" "$REPO_DIR"
  if [ -f "$REPO_DIR/package.json" ]; then SRC="$REPO_DIR"; else SRC="$REPO_DIR/${REPO_SUBDIR:-firmware}"; fi
  [ -f "$SRC/package.json" ] || { echo "no package.json in $SRC — set REPO_SUBDIR"; exit 1; }
  ln -sfn "$SRC" "$APP_DIR"
fi
cd "$APP_DIR"
sudo -H -u $APP_USER npm ci

CHROME=""
if [ "$LOCAL_BROWSER" = "1" ]; then
  log "Headless Chromium for the agents' browser"
  PW_VER=$(node -p "require('./node_modules/playwright-core/package.json').version")
  npx --yes "playwright@$PW_VER" install-deps chromium
  sudo -H -u $APP_USER npx --yes "playwright@$PW_VER" install chromium
  CHROME=$(sudo -H -u $APP_USER bash -lc 'ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1')
  echo "chromium: ${CHROME:-not found}"
fi

log "Environment (.env)"
if [ ! -f .env ]; then
  sudo -H -u $APP_USER cp .env.example .env
  set_env() { sudo -H -u $APP_USER sed -i "s#^$1=.*#$1=\"$2\"#" .env; }
  set_env VAULT_KEY "$(openssl rand -hex 32)"
  set_env CRON_SECRET "$(openssl rand -hex 24)"
  set_env DATABASE_URL "file:/home/$APP_USER/data/firmware.db"
  set_env NEXT_PUBLIC_SITE_URL "https://$DOMAIN"
  set_env ALLOWED_ORIGINS "${FRONTEND:+$FRONTEND,}*.lovable.app,*.lovableproject.com"
  set_env FIRMWARE_MODE "mock"
  [ -n "$FRONTEND" ] && set_env APP_URL "${FRONTEND%%,*}"
  set_env SITES_DOMAIN "$SITES_DOMAIN"
  echo "PORT=\"$PORT\"" | sudo -H -u $APP_USER tee -a .env >/dev/null
  set_env ALLOW_PRIVATE_URLS "0"
  [ -n "$CHROME" ] && set_env CHROMIUM_PATH "$CHROME"
  chmod 600 .env
  echo "Created .env (mock mode). A fresh VAULT_KEY was generated — BACK IT UP NOW (see DEPLOY.md)."
else
  echo ".env exists — left untouched"
fi
sudo -H -u $APP_USER mkdir -p /home/$APP_USER/data /home/$APP_USER/backups /home/$APP_USER/logs

log "Database + build"
sudo -H -u $APP_USER npm run db:push
sudo -H -u $APP_USER npm run build

log "Start with pm2 (auto-restart + start on boot)"
sudo -H -u $APP_USER PORT="$PORT" pm2 start deploy/ecosystem.config.cjs
sudo -H -u $APP_USER pm2 save
env PATH="$PATH" pm2 startup systemd -u $APP_USER --hp /home/$APP_USER >/dev/null
systemctl enable "pm2-$APP_USER" >/dev/null 2>&1 || true

log "HTTPS reverse proxy for $DOMAIN → 127.0.0.1:$PORT"
if systemctl is-active --quiet nginx; then
  echo "nginx is already running — adding a server block + Let's Encrypt via certbot"
  if [ -n "$SITES_DOMAIN" ]; then
    echo "  (nginx can't issue per-company certificates on demand: company sites will be served at https://$DOMAIN/s/<ticker>)"
    sudo -H -u $APP_USER sed -i 's#^SITES_DOMAIN=.*#SITES_DOMAIN=""#' "$APP_DIR/.env"
  fi
  apt-get install -y certbot python3-certbot-nginx
  sed -e "s#{{DOMAIN}}#$DOMAIN#g" -e "s#{{PORT}}#$PORT#g" deploy/nginx-site.conf > /etc/nginx/sites-available/firmware
  ln -sf /etc/nginx/sites-available/firmware /etc/nginx/sites-enabled/firmware
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
elif systemctl is-active --quiet apache2; then
  echo "Apache is serving ports 80/443. Add a reverse proxy for $DOMAIN → http://127.0.0.1:$PORT yourself (mod_proxy), then get a certificate with certbot --apache."
else
  if ! command -v caddy >/dev/null; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
  SITE=$(sed -e "s#{{DOMAIN}}#$DOMAIN#g" -e "s#{{EMAIL}}#$EMAIL#g" -e "s#{{PORT}}#$PORT#g" -e "s#{{SITES_DOMAIN}}#${SITES_DOMAIN:-yourdomain}#g" deploy/Caddyfile)
  # no SITES_DOMAIN: drop the company-subdomain block (sites are served at /s/<ticker> instead)
  [ -z "$SITES_DOMAIN" ] && SITE=$(echo "$SITE" | sed '/^# company websites/,$d')
  CANDIDATE=$(mktemp)
  if [ -s /etc/caddy/Caddyfile ] && grep -qE '^[^#].*\{' /etc/caddy/Caddyfile && ! grep -q "^# managed by firmware" /etc/caddy/Caddyfile; then
    # existing Caddy config from another project: keep it exactly, add our sites + the on-demand "ask" hook
    cp /etc/caddy/Caddyfile "$CANDIDATE"
    if ! grep -q "^$DOMAIN " "$CANDIDATE"; then
      ASK="on_demand_tls {\n\t\task http://127.0.0.1:$PORT/api/sites/allowed\n\t}"
      if ! grep -q "on_demand_tls" "$CANDIDATE"; then
        if head -1 "$CANDIDATE" | grep -qE '^\{\s*$'; then
          { head -1 "$CANDIDATE"; printf '\t%b\n' "$ASK"; tail -n +2 "$CANDIDATE"; } > "$CANDIDATE.2" && mv "$CANDIDATE.2" "$CANDIDATE"   # into the existing global block
        else
          printf '{\n\t%b\n}\n\n' "$ASK" | cat - "$CANDIDATE" > "$CANDIDATE.2" && mv "$CANDIDATE.2" "$CANDIDATE"
        fi
      fi
      printf '\n%s\n' "$(echo "$SITE" | sed '/^{/,/^}/d')" >> "$CANDIDATE"
    fi
  else
    echo "$SITE" > "$CANDIDATE"
  fi
  # never install a config Caddy rejects: other projects on this server would go down with it
  if caddy validate --adapter caddyfile --config "$CANDIDATE" >/dev/null 2>&1; then
    [ -s /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
    cp "$CANDIDATE" /etc/caddy/Caddyfile
  else
    caddy validate --adapter caddyfile --config "$CANDIDATE" || true
    echo "The new Caddy config didn't validate, so /etc/caddy/Caddyfile was left unchanged (candidate kept at $CANDIDATE)."
    exit 1
  fi
  caddy validate --config /etc/caddy/Caddyfile
  # validate runs as root and may create the log file as root — hand it back to caddy
  touch /var/log/caddy/firmware.log && chown -R caddy:caddy /var/log/caddy
  systemctl reload caddy || systemctl restart caddy
  sleep 2; systemctl is-active --quiet caddy || { journalctl -u caddy --no-pager | tail -20; echo "caddy failed to start (see above)"; }
fi

log "Cron: nightly DB backup + daily Meteora partner fee claim"
cat > /etc/cron.d/firmware <<CRON
SHELL=/bin/bash
# m h dom mon dow user command
17 3 * * * $APP_USER $APP_DIR/deploy/backup.sh >> /home/$APP_USER/logs/backup.log 2>&1
41 4 * * * $APP_USER cd $APP_DIR && grep -q '^DBC_CONFIG="..*"' .env && npm run -s meteora:claim >> /home/$APP_USER/logs/claim.log 2>&1
CRON
chmod 644 /etc/cron.d/firmware

log "Done"
cat <<MSG

  Backend:   https://$DOMAIN/api/health    (DNS A record for $DOMAIN → this droplet's IP)
  App port:  127.0.0.1:$PORT (private)
  App dir:   $APP_DIR   (user: $APP_USER)
  Logs:      sudo -H -u $APP_USER pm2 logs firmware
  Config:    sudo -H -u $APP_USER nano $APP_DIR/.env   then   sudo -H -u $APP_USER pm2 restart firmware
  Update:    sudo -H -u $APP_USER $APP_DIR/deploy/update.sh

  Next: back up VAULT_KEY, add your API keys to .env, test in mock mode, then follow DEPLOY.md to go live.
MSG
