#!/usr/bin/env bash
# Switch Hypeware to LIVE on Solana mainnet with StonkFun as the launch venue (Raydium LaunchLab under StonkFun's platform).
#
#   sudo FEE_WALLET=<your wallet> RPC=<mainnet RPC, e.g. Helius> bash deploy/go-live-stonkfun.sh
#
# Optional:
#   PUBLIC_RPC=<RPC the website's wallets use>     default: same as RPC (restrict the key to your domain)
#   FEE_SHARE_BPS=2000                             Hypeware's share of each company's creator fees (2000 = 20%)
#   YES=1                                          skip the confirmation prompt
# No Meteora config, partner wallet or SOL is needed for this step. It never launches anything:
# it finishes by SIMULATING a launch (npm run stonkfun:probe).
set -euo pipefail

APP_USER="${APP_USER:-firmware}"
APP_DIR="${APP_DIR:-/home/$APP_USER/app}"
FEE_WALLET="${FEE_WALLET:?Set FEE_WALLET=<your Solana wallet> (receives compute repayments and the Hypeware fee share)}"
RPC="${RPC:?Set RPC=<your mainnet RPC URL> (Helius/Triton/QuickNode)}"
PUBLIC_RPC="${PUBLIC_RPC:-$RPC}"
FEE_SHARE_BPS="${FEE_SHARE_BPS:-2000}"

cd "$APP_DIR"
as() { sudo -H -u "$APP_USER" "$@"; }
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
set_env() { if grep -q "^$1=" .env; then as sed -i "s|^$1=.*|$1=\"$2\"|" .env; else echo "$1=\"$2\"" | as tee -a .env >/dev/null; fi; }
get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"' || true; }

[[ "$RPC" == *devnet* || "$RPC" == *testnet* ]] && { echo "RPC looks like devnet/testnet: $RPC"; exit 1; }
as npm run -s wallet -- address "$FEE_WALLET" >/dev/null 2>&1 || { echo "FEE_WALLET is not a valid Solana address"; exit 1; }

if [ "${YES:-0}" != "1" ]; then
  printf '\n\033[1;31mThis switches Hypeware to MAINNET with real money.\033[0m Launches, payments and agent spending will be real.\n'
  read -r -p 'Type MAINNET to continue: ' ans; [ "$ans" = "MAINNET" ] || { echo "cancelled"; exit 1; }
fi

say "Backing up .env"
as cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"
[ -n "$(get_env VAULT_KEY)" ] || { echo "VAULT_KEY missing from .env"; exit 1; }
printf '\033[1;33m! Back up VAULT_KEY offline now (password manager). Losing it, or this server, loses every treasury.\033[0m\n'

say "Mainnet database"
OLD_DB="$(get_env DATABASE_URL)"
if [[ "$OLD_DB" != *mainnet* ]]; then set_env DATABASE_URL "file:/home/$APP_USER/data/mainnet.db"; fi
as npm run -s premigrate >/dev/null || true
as npm run -s db:push >/dev/null && echo "  database ready ($(get_env DATABASE_URL))"

say "Pointing everything at mainnet + StonkFun"
set_env SOLANA_RPC_URL "$RPC"
set_env PUBLIC_SOLANA_RPC_URL "$PUBLIC_RPC"
set_env SOLANA_CLUSTER "mainnet-beta"
set_env PLATFORM_FEE_WALLET "$FEE_WALLET"
set_env LAUNCH_VENUE "stonkfun"
set_env CREATOR_FEE_SHARE_BPS "$FEE_SHARE_BPS"
set_env CLAIM_EVERY_MIN "60"
set_env VANITY_MINTS "1"

say "Checking the StonkFun launch path (simulation only, nothing is sent)"
as env FIRMWARE_MODE=live npm run -s stonkfun:probe || { echo; echo "The probe found problems. Fix them (or send me the output) before going live."; exit 1; }

say "Switching to LIVE"
set_env FIRMWARE_MODE "live"
as pm2 restart firmware --update-env >/dev/null
sleep 8
PORT="$(get_env PORT)"; PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
curl -fsS "http://127.0.0.1:$PORT/api/config" | grep -oE '"(mode|cluster|venue)":"[^"]+"' | tr '\n' ' '; echo

cat <<MSG

✓ Hypeware is LIVE on mainnet, launching on StonkFun.
  • Do one small real launch yourself first (SOL pair, small dev buy). Check it appears on stonkfun.xyz within a
    couple of minutes and that the dev-buy tokens reach your wallet.
  • Fee income is collected every 60 min, swapped to SOL; Hypeware keeps $((FEE_SHARE_BPS / 100))%.
  • Logs: sudo -u $APP_USER pm2 logs firmware
  • Undo: restore a .env.bak-* file and pm2 restart firmware.
MSG
