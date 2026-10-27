#!/usr/bin/env bash
# Switch Stonkware to LIVE on Solana MAINNET (real SOL).
#
#   sudo FEE_WALLET=<your wallet> RPC=<mainnet RPC, e.g. Helius> bash deploy/go-live-mainnet.sh
#
# Optional:
#   PUBLIC_RPC=<RPC the website's wallets use>   default: same as RPC (use a domain-restricted key if it's a paid RPC)
#   CARRY_FROM=file:/home/firmware/data/devnet.db  carry over unused vanity addresses + the flagship (default: the current DB)
#   YES=1                                          skip the confirmation prompt
#
# What it does: backs up .env · fresh mainnet database (old one kept) · carries over vanity pool + flagship ·
# funds check for the partner wallet · creates the mainnet Meteora config (real SOL, ~0.05) · switches to live.
# It never runs the devnet smoke test here: on mainnet that would launch a real token.
set -euo pipefail

APP_USER="${APP_USER:-firmware}"
APP_DIR="${APP_DIR:-/home/$APP_USER/app}"
FEE_WALLET="${FEE_WALLET:?Set FEE_WALLET=<your Solana wallet> (receives compute repayments and Stonkware's revenue share)}"
RPC="${RPC:?Set RPC=<your mainnet RPC URL> (Helius/Triton/QuickNode; the public RPC can't run fee claims)}"
PUBLIC_RPC="${PUBLIC_RPC:-$RPC}"
NEED_SOL="${NEED_SOL:-0.06}"

cd "$APP_DIR"
as() { sudo -H -u "$APP_USER" "$@"; }
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
set_env() { if grep -q "^$1=" .env; then as sed -i "s|^$1=.*|$1=\"$2\"|" .env; else echo "$1=\"$2\"" | as tee -a .env >/dev/null; fi; }
del_env() { as sed -i "/^$1=/d" .env; }
get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"' || true; }

[[ "$RPC" == *devnet* || "$RPC" == *testnet* ]] && { echo "RPC looks like devnet/testnet: $RPC"; exit 1; }
if [[ "$RPC" == *api.mainnet-beta.solana.com* && "${ALLOW_PUBLIC_RPC:-0}" != "1" ]]; then
  echo "The public mainnet RPC rate-limits and blocks the calls fee claims need. Use a provider URL (Helius free tier works), or set ALLOW_PUBLIC_RPC=1."; exit 1
fi
as npm run -s wallet -- address "$FEE_WALLET" >/dev/null 2>&1 || { echo "FEE_WALLET is not a valid Solana address"; exit 1; }

if [ "${YES:-0}" != "1" ]; then
  printf '\n\033[1;31mThis switches Stonkware to MAINNET with real money.\033[0m Launches, payments, fee claims and agent spending will be real.\n'
  read -r -p 'Type MAINNET to continue: ' ans; [ "$ans" = "MAINNET" ] || { echo "cancelled"; exit 1; }
fi

say "Backing up .env"
as cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
VK="$(get_env VAULT_KEY)"; [ -n "$VK" ] || { echo "VAULT_KEY missing from .env"; exit 1; }
warn "Make sure VAULT_KEY is backed up offline (password manager). Losing it loses every mainnet treasury."

say "Fresh mainnet database (the current one is kept as-is)"
OLD_DB="$(get_env DATABASE_URL)"
CARRY_FROM="${CARRY_FROM:-$OLD_DB}"
if [[ "$OLD_DB" != *mainnet* ]]; then
  set_env DATABASE_URL "file:/home/$APP_USER/data/mainnet.db"
  echo "  new database: mainnet.db (previous: ${OLD_DB#file:})"
fi
as npm run -s db:push >/dev/null && echo "  database ready"

say "Pointing everything at mainnet"
set_env SOLANA_RPC_URL "$RPC"
set_env PUBLIC_SOLANA_RPC_URL "$PUBLIC_RPC"
set_env SOLANA_CLUSTER "mainnet-beta"
set_env PLATFORM_FEE_WALLET "$FEE_WALLET"
set_env CLAIM_EVERY_MIN "120"
set_env VANITY_MINTS "1"
del_env VANITY_ANY_CLUSTER
del_env PRINTFUL_CONFIRM   # default on mainnet: real orders are submitted for printing
[ "$PUBLIC_RPC" = "$RPC" ] && [[ "$RPC" == *api-key* || "$RPC" == *helius* ]] && warn "The website will use your RPC URL too (it's visible in the browser). Restrict that key to stonkware.com in your RPC dashboard, or pass PUBLIC_RPC separately."

if [[ -n "$CARRY_FROM" && "$CARRY_FROM" != "$(get_env DATABASE_URL)" ]]; then
  say "Carrying over the vanity pool and the flagship from ${CARRY_FROM#file:}"
  # FIRMWARE_MODE is still the old mode here; mark live so on-chain checks use mainnet
  as env FIRMWARE_MODE=live npm run -s carry-over -- --from "$CARRY_FROM" || warn "carry-over failed (continuing): run it later with npm run carry-over -- --from $CARRY_FROM"
fi

say "Partner wallet (Stonkware's Meteora fee claimer)"
[ -f partner.json ] || as npm run -s wallet -- new partner.json >/dev/null
chmod 600 partner.json
set_env PARTNER_KEYPAIR "$APP_DIR/partner.json"
PARTNER="$(as npm run -s wallet -- address partner.json)"
echo "  partner address: $PARTNER"
bal() { as npm run -s wallet -- balance partner.json 2>/dev/null || echo 0; }
while awk "BEGIN{exit !($(bal) < $NEED_SOL)}"; do
  echo "  balance $(bal) SOL. Send at least $NEED_SOL real SOL to $PARTNER (pays for the Meteora config). Checking again in 20s…"
  sleep 20
done
echo "  balance $(bal) SOL ✓"

say "Meteora launchpad config (mainnet)"
OLD_CFG="$(get_env DBC_CONFIG)"
CFG_NET="$(get_env DBC_CONFIG_CLUSTER)"
if [ -z "$OLD_CFG" ] || [ "$CFG_NET" != "mainnet-beta" ]; then
  [ -n "$OLD_CFG" ] && echo "  replacing the devnet config ($OLD_CFG)"
  as npm run -s meteora:config -- --dry-run | tail -n 8
  OUT="$(as npm run -s meteora:config 2>&1)" || { echo "$OUT"; exit 1; }
  echo "$OUT" | tail -n 5
  CFG="$(echo "$OUT" | grep -oE 'DBC_CONFIG="[^"]+"' | cut -d'"' -f2)"
  [ -n "$CFG" ] || { echo "Could not read the config address from the output above."; exit 1; }
  set_env DBC_CONFIG "$CFG"
  set_env DBC_CONFIG_CLUSTER "mainnet-beta"
else
  echo "  already set: $OLD_CFG"
fi

say "Switching to LIVE on mainnet"
set_env FIRMWARE_MODE "live"
as pm2 restart firmware --update-env >/dev/null
sleep 8
PORT="$(get_env PORT)"; PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
curl -fsS "http://127.0.0.1:$PORT/api/config" | grep -oE '"(mode|cluster)":"[^"]+"' | tr '\n' ' '; echo
as npm run -s vanity -- status || true

cat <<MSG

✓ Stonkware is LIVE on mainnet.
  • Phantom: turn Testnet Mode OFF.
  • Do one small real launch yourself first (small dev buy), then check the pool on Meteora / Jupiter and its first fee claim.
  • Flagship: launch day → sudo -u $APP_USER npm run flagship -- set-ca <mint>
  • Partner fees are claimed daily by cron (meteora:claim); ${FLAGSHIP_SHARE_PCT:-50}% is forwarded to the flagship.
  • Logs: sudo -u $APP_USER pm2 logs firmware
  • Undo: restore a .env.bak-* file and pm2 restart firmware.
MSG
