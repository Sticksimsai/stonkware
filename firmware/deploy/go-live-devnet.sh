#!/usr/bin/env bash
# Switch a running Hypeware droplet from mock mode to LIVE mode on Solana DEVNET (free test SOL).
# Safe to re-run: it skips anything already done. Your mock database and .env are backed up, not deleted.
#
#   sudo FEE_WALLET=<your Phantom address> bash deploy/go-live-devnet.sh
#
# Optional: RPC=<devnet RPC URL, e.g. Helius devnet>  (default: public devnet RPC)
set -euo pipefail

APP_USER="${APP_USER:-firmware}"
APP_DIR="${APP_DIR:-/home/$APP_USER/app}"
RPC="${RPC:-https://api.devnet.solana.com}"
FEE_WALLET="${FEE_WALLET:?Set FEE_WALLET=<your Solana wallet address> (receives compute repayments and the 5% revenue share)}"
NEED_SOL="${NEED_SOL:-2}"

cd "$APP_DIR"
as() { sudo -H -u "$APP_USER" "$@"; }
say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
set_env() { # set_env KEY VALUE  (replaces the line or appends it)
  if grep -q "^$1=" .env; then as sed -i "s|^$1=.*|$1=\"$2\"|" .env; else echo "$1=\"$2\"" | as tee -a .env >/dev/null; fi
}
get_env() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | tr -d '"' || true; }

[[ "$RPC" == *devnet* ]] || { echo "RPC must be a devnet endpoint (got $RPC)"; exit 1; }

say "Backing up .env"
as cp .env ".env.bak-$(date +%Y%m%d-%H%M%S)"

say "Partner wallet (Hypeware's Meteora fee claimer)"
if [ ! -f partner.json ]; then as npm run -s wallet -- new partner.json >/dev/null; fi
chmod 600 partner.json
PARTNER="$(as npm run -s wallet -- address partner.json)"
echo "  partner address: $PARTNER"

say "Pointing the backend at devnet"
set_env SOLANA_RPC_URL "$RPC"
set_env PUBLIC_SOLANA_RPC_URL "$RPC"
set_env SOLANA_CLUSTER "devnet"
set_env PARTNER_KEYPAIR "$APP_DIR/partner.json"
set_env PLATFORM_FEE_WALLET "$FEE_WALLET"
set_env CLAIM_EVERY_MIN "10"
DB_NOW="$(get_env DATABASE_URL)"
if [[ "$DB_NOW" != *devnet* ]]; then
  set_env DATABASE_URL "file:/home/$APP_USER/data/devnet.db"   # fresh database; the mock one is kept as-is
  echo "  new database: devnet.db (mock data kept in ${DB_NOW#file:})"
fi
as npm run -s db:push >/dev/null && echo "  database ready"

say "Funding the partner wallet with devnet SOL (needs $NEED_SOL SOL)"
bal() { as npm run -s wallet -- balance partner.json 2>/dev/null || echo 0; }
as npm run -s wallet -- airdrop partner.json 2 2>/dev/null || true
while awk "BEGIN{exit !($(bal) < $NEED_SOL)}"; do
  echo "  balance $(bal) SOL. Get free devnet SOL for $PARTNER at https://faucet.solana.com (pick Devnet). Checking again in 15s…"
  sleep 15
done
echo "  balance $(bal) SOL ✓"

say "Meteora launchpad config"
if [ -z "$(get_env DBC_CONFIG)" ]; then
  OUT="$(as npm run -s meteora:config 2>&1)" || { echo "$OUT"; exit 1; }
  echo "$OUT" | tail -n 6
  CFG="$(echo "$OUT" | grep -oE 'DBC_CONFIG="[^"]+"' | cut -d'"' -f2)"
  [ -n "$CFG" ] || { echo "Could not read the config address from the output above."; exit 1; }
  set_env DBC_CONFIG "$CFG"
  set_env DBC_CONFIG_CLUSTER "devnet"
else
  echo "  already set: $(get_env DBC_CONFIG)"
fi

say "End-to-end devnet test (create pool → dev buy → trade → claim fees)"
as npm run -s meteora:smoke

say "Switching to LIVE"
set_env FIRMWARE_MODE "live"
as pm2 restart firmware --update-env >/dev/null
sleep 6
PORT="$(get_env PORT)"; PORT="${PORT:-3000}"
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo
curl -fsS "http://127.0.0.1:$PORT/api/config" | grep -oE '"(mode|cluster)":"[^"]+"' | tr '\n' ' '; echo

cat <<MSG

✓ Hypeware is LIVE on devnet.
  • In Phantom: Settings → Developer Settings → Testnet Mode ON (Solana Devnet), then get devnet SOL
    for your own wallet at https://faucet.solana.com.
  • Launch a company on the website. Then generate trading fees with:
      cd $APP_DIR && sudo -u $APP_USER npm run devnet:trade -- <TICKER> 0.1 3
  • Fees are claimed into each treasury every 10 minutes (CLAIM_EVERY_MIN).
  • Logs: sudo -u $APP_USER pm2 logs firmware
  • Undo: set FIRMWARE_MODE="mock" in .env (or restore a .env.bak-*) and pm2 restart firmware.
MSG
