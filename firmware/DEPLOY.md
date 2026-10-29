# Deploy: Lovable frontend + DigitalOcean backend

```
firmware.xyz  (Lovable: React UI)  ──HTTPS JSON──▶  api.firmware.xyz  (Droplet: this repo)
                                                     Caddy (HTTPS) → Next.js API + scheduler (pm2)
                                                     SQLite (/home/firmware/data), nightly backups
```

## 0. What you need
- A domain. Below, `firmware.xyz` is the frontend and `api.firmware.xyz` is the backend.
- A DigitalOcean account. Use **Ubuntu 24.04** with **4 GB RAM / 2 vCPU** ($24/mo). If you use Browserbase for the agents' browser, 2 GB is enough.
- A GitHub account. Push this repo to it; private is fine.
- Keys:
  - **Helius RPC URL**: mainnet, paid tier recommended.
  - **OpenRouter API key**: the agents' models.
  - **Browserbase API key + project ID**: optional, gives the live browser view.
  - **Wallets**: `PLATFORM_FEE_WALLET` (a Solana address) and a **partner keypair** for Meteora fees.

## 1. Push the code to GitHub (on your computer)
```bash
cd firmware
git init && git add . && git commit -m "Hypeware backend"
git branch -M main
git remote add origin https://github.com/<you>/firmware.git
git push -u origin main
```
`.env` and `*.db` are already in `.gitignore`. Never commit them.

## 2. Create the droplet and point DNS at it
1. DigitalOcean → Create → Droplet → Ubuntu 24.04 → 4 GB → add **your SSH key** → Create.
2. At your DNS provider, add an **A record**: `api` → the droplet's IPv4. Wait until `ping api.firmware.xyz` shows that IP.

## 2b. Using a droplet that already runs another project?
Check it first. The check is read-only and changes nothing:
```bash
scp deploy/check-droplet.sh root@<DROPLET_IP>:~ && ssh root@<DROPLET_IP> bash check-droplet.sh
```
- **Resources Hypeware needs:** about 1.5 GB of free RAM if Chromium runs locally (much less with Browserbase), about 5 GB of disk, and Node 20 or newer.
- **What the setup script does on a shared droplet:**
  - picks port 3100 if port 3000 is taken;
  - never resets or enables the firewall;
  - keeps your existing Node;
  - adds a site to an existing **nginx** (with certbot) or **Caddy** instead of replacing it.

## 3. Run the setup script (from your terminal)
```bash
ssh root@<DROPLET_IP>
curl -fsSL https://raw.githubusercontent.com/<you>/firmware/main/deploy/setup-droplet.sh -o setup.sh
DOMAIN=api.firmware.xyz \
REPO=https://github.com/<you>/firmware.git \
EMAIL=you@example.com \
FRONTEND=https://firmware.xyz \
bash setup.sh
```

**Private repo:** use `REPO=https://<github-token>@github.com/<you>/firmware.git`, or add a deploy key.

**What the script does:**
- installs updates, sets up a firewall (SSH/80/443 only), fail2ban and 2 GB swap;
- installs Node 22, pm2, Caddy (automatic HTTPS) and headless Chromium;
- creates the `firmware` user, clones the repo, writes `.env` in **mock mode** with a fresh `VAULT_KEY`, creates the database and builds the app;
- starts the app with pm2 (restarts on crash and on reboot) and sets up nightly backups plus the daily Meteora partner fee claim.

Check that it works: open `https://api.firmware.xyz/api/health`. It should return `{"ok":true,"mode":"mock"}`.

## 4. Back up the vault key
```bash
sudo -u firmware grep VAULT_KEY /home/firmware/app/.env
```
Store it in a password manager. It decrypts every company treasury: lose it and the funds are gone; leak it and anyone can take them.

## 5. Add your keys
```bash
sudo -u firmware nano /home/firmware/app/.env
```

| Variable | Value |
|---|---|
| `OPENROUTER_API_KEY` | your OpenRouter key |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID` | optional; enables the live browser stream |
| `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL` | your Helius URL |
| `PLATFORM_FEE_WALLET` | your platform wallet address |
| `ALLOWED_ORIGINS` | add your custom frontend domain when you have it |

Apply the changes with `sudo -u firmware pm2 restart firmware`.

## 6. Build the frontend on Lovable
Follow **`docs/LOVABLE_PROMPT.md`**: 6 prompts to paste in order. Upload the images in `docs/brand/` and use `docs/API.md` as the contract.

In Lovable's environment settings, set `VITE_API_URL=https://api.firmware.xyz`. Publish, then connect `firmware.xyz` (Lovable will show you the DNS records to add).

## 7. Test everything in mock mode
On the live site:
1. Launch a test company.
2. Watch the agent work in the live view.
3. Buy one of its offers and receive the delivery.

## 8. Meteora (on the droplet)
1. Copy your partner keypair to the droplet:
   ```bash
   scp partner.json firmware@<DROPLET_IP>:/home/firmware/app/partner.json
   ```
2. Restrict it and point `.env` at it:
   ```bash
   sudo -u firmware chmod 600 /home/firmware/app/partner.json
   # in .env:  PARTNER_KEYPAIR="/home/firmware/app/partner.json"
   ```
3. Do a devnet end-to-end test (the partner wallet needs ~2 devnet SOL):
   ```bash
   cd /home/firmware/app
   sudo -u firmware SOLANA_RPC_URL=https://api.devnet.solana.com npm run meteora:smoke
   ```
4. Create the mainnet config. Preview it, then create it:
   ```bash
   sudo -u firmware npm run meteora:config -- --dry-run
   sudo -u firmware npm run meteora:config
   ```
   Paste the `DBC_CONFIG="…"` line it prints into `.env`.

## 8b. Live on devnet (recommended first)
Use real transactions, real Meteora pools and real agents, but with free test SOL. One command does it all:
```bash
cd /home/firmware/app
sudo FEE_WALLET=<your Solana address> bash deploy/go-live-devnet.sh
```
- **What it does:**
  - backs up `.env`;
  - creates `partner.json`;
  - points everything at devnet;
  - starts a fresh `devnet.db` (your mock data is kept);
  - waits for you to fund the partner wallet from faucet.solana.com;
  - creates the Meteora config;
  - runs the end-to-end smoke test;
  - switches to `FIRMWARE_MODE="live"`.
- **The frontend follows automatically:** it reads the network and RPC from `/api/config`, so Vercel doesn't need a redeploy.
- **Generate trading fees:** `sudo -u firmware npm run devnet:trade -- <TICKER> 0.1 3`. Fees are claimed every `CLAIM_EVERY_MIN` (10 minutes on devnet).
- **Wallet helper:** `npm run wallet -- new|address|balance|airdrop <file|address>`.

**Moving to mainnet:**
1. Set `SOLANA_RPC_URL` and `PUBLIC_SOLANA_RPC_URL` to a mainnet RPC (Helius).
2. Remove `SOLANA_CLUSTER` and `DBC_CONFIG`, and set `CLAIM_EVERY_MIN="120"`.
3. Use a new `DATABASE_URL`, then run `npm run db:push`.
4. Fund `partner.json` with about 0.05 real SOL.
5. Run `npm run meteora:config` and paste the new `DBC_CONFIG`.
6. Run `pm2 restart firmware`.

## 8c. Switch to mainnet (one command)
```bash
cd /home/firmware/app
sudo FEE_WALLET=<your wallet> RPC="<mainnet RPC URL>" bash deploy/go-live-mainnet.sh
```
- **What it does:**
  - asks you to type MAINNET, then backs up `.env`;
  - starts a fresh `mainnet.db` (devnet data stays in the old file);
  - carries over unused vanity addresses and the flagship (`npm run carry-over`);
  - waits for about 0.06 real SOL in the partner wallet;
  - creates the mainnet Meteora config;
  - switches to live and restarts.
- **What it skips:** the smoke test, because on mainnet that would launch a real token.
- **RPC:** use a provider URL; Helius' free tier works. The website's wallets use `PUBLIC_RPC`, which defaults to the same URL, so restrict that key to your domain.

## 9. Go live
1. In `.env`, set `FIRMWARE_MODE="live"`.
2. Run `sudo -u firmware pm2 restart firmware`.
3. Launch one real company with a small dev buy. Check the pool on Meteora or Jupiter, then watch its first fee claim and shift.

## Everyday commands
```bash
sudo -u firmware pm2 logs firmware                  # live logs
sudo -u firmware pm2 restart firmware               # after editing .env
sudo -u firmware /home/firmware/app/deploy/update.sh  # deploy new code from GitHub (backs up first)
ls /home/firmware/backups                           # nightly DB backups (14 days)
tail -f /home/firmware/logs/claim.log               # partner fee claims
```

**Off-site backups:** create a DigitalOcean Space, install and configure `s3cmd`, then add `BACKUP_S3_URI=s3://<space>/firmware` to `/etc/cron.d/firmware`. Or move the database to Turso (`DATABASE_URL=libsql://…`).

## Troubleshooting
- **No HTTPS certificate:** DNS isn't pointing at the droplet yet. Check `dig api.firmware.xyz`, then `systemctl restart caddy`.
- **The frontend gets CORS errors:** the frontend's origin is missing from `ALLOWED_ORIGINS`. Add it, then restart.
- **The agent never browses visually:** `CHROMIUM_PATH` is empty. Set Browserbase keys or re-run the Chromium step in the setup script.
- **Out of memory during the build:** use the 4 GB droplet, or run `sudo -u firmware NODE_OPTIONS=--max-old-space-size=1536 npm run build`.

## The flagship: Hypeware's own token (/firmware)

Set it up before launch. Its agent starts building right away, and the page shows a countdown. Write the aim in a text file on the droplet, e.g. `/home/firmware/aim.txt`, then run:
```bash
cd /home/firmware/app
sudo -u firmware npm run flagship -- create --name "Hypeware" --ticker FIRM \
  --model anthropic/claude-sonnet-5.5 --creator <your wallet> --aim-file /home/firmware/aim.txt \
  --image /home/firmware/logo.png --venue Meteora --launch-at 2026-10-20T16:00:00Z
```
- **Treasury:** `create` prints the agent's treasury address. Send it a little SOL to start; after that it's topped up with `FLAGSHIP_SHARE_PCT` (default 50%) of Hypeware's revenue.
- **Launch day:** `sudo -u firmware npm run flagship -- set-ca <mint>` checks the mint on-chain, switches the page to live price, chart and buy links, and wakes the agent.
- **Changes:** `npm run flagship -- update --aim-file … | --model … | --launch-at … | --image …` and `npm run flagship -- status`.
- **Creator wallet:** `--creator` is the wallet that signs bot connections on the page.

### Self-improving: the flagship builds Hypeware

The flagship agent can read Hypeware's code and ship improvements as pull requests.
- **What can ship on its own:** changes that only touch the website, docs, or its own agent tools and prompts merge automatically once CI passes.
- **What needs your approval:** anything touching money, keys, payments, auth, dependencies, the database or deploy code waits for you on GitHub. The rules live in `src/lib/selfdev/policy.ts`, which is itself protected.

1. **CI:** copy `.github/workflows/ci.yml` (from the zip root) to the root of your repo and push. Every PR then gets typecheck, tests and builds.
2. **GitHub token:** GitHub → Settings → Developer settings → Fine-grained tokens → choose only the firmware repo, with Contents (read & write), Pull requests (read & write), Checks (read) and Metadata (read). On the droplet, add `GITHUB_TOKEN="…"` and `GITHUB_REPO="dev79-code/firmware"` to `/home/firmware/app/.env.local`, then run `sudo -u firmware pm2 restart firmware`.
3. **Auto-deploy:** Vercel already redeploys the website on every merge. For the backend:
   ```bash
   printf 'PATH=/usr/local/bin:/usr/bin:/bin\n*/5 * * * * firmware /home/firmware/app/deploy/auto-update.sh\n' | sudo tee /etc/cron.d/firmware-autoupdate
   ```
   Every 5 minutes it pulls new commits, rebuilds, and health-checks the app. If the new version fails, it rolls back to the previous one and skips the bad commit. The log is at `/home/firmware/logs/auto-update.log`.
4. **Model:** `sudo -u firmware npm run flagship -- update --model anthropic/claude-opus-5.5`.

## Vanity contract addresses (…firm)

Every launch gets a CA from the pool. When the pool is empty it falls back to a random address, so a launch never fails because of this.
```bash
# 1. copy your keypair files to the droplet (from your computer)
scp *firm.json root@<DROPLET_IP>:/home/firmware/vanity/
# 2. import them into the pool (sealed with VAULT_KEY), then destroy the files
cd /home/firmware/app && sudo -u firmware npm run vanity -- import /home/firmware/vanity/*.json && shred -u /home/firmware/vanity/*.json
# 3. check the pool
sudo -u firmware npm run vanity -- status
```
- **Refill automatically:** each "…firm" address takes about 5–10 CPU-minutes to find. Add a low-priority nightly job that keeps at least 10 in the pool:
  ```bash
  echo '17 3 * * * firmware cd /home/firmware/app && nice -n 19 npm run -s vanity -- grind --suffix firm --if-below 10 --count 4 --threads 1 >> /home/firmware/logs/vanity.log 2>&1' | sudo tee /etc/cron.d/firmware-vanity
  ```
- **Abandoned launches:** a launch that isn't funded within `VANITY_HOLD_HOURS` (6) gets a random address instead, and its vanity address goes back into the pool.

## Optional abilities

- **AI images and video (Higgsfield):**
  1. Put `HF_CREDENTIALS="key-id:key-secret"` in `/home/firmware/app/.env.local`. It's git-ignored; never paste it in chat or commit it.
  2. Run `sudo -u firmware npm run higgsfield:example`. It makes one billable 5s Seedance 2.5 render and prints the video URL, or exactly why it failed.
  3. Run `sudo -u firmware pm2 restart firmware`.
  4. Set `HIGGSFIELD_VIDEO_USD_PER_SEC` to the price your Higgsfield console shows for Seedance 2.5 at your resolution.
- **Print-on-demand (Printful):** set `PRINTFUL_API_KEY`, plus `PRINTFUL_STORE_ID` for account-level tokens, and add a payment method in Printful. On devnet, orders are saved as drafts, so nothing is printed.
- **Telegram and Discord bots:** nothing to set. Creators connect their bot accounts on their company page. Webhooks need the backend to be reachable over HTTPS, which Caddy already provides.

## Company subdomains (`<ticker>.yourdomain.com`)
Every company's website is served on its own subdomain, with automatic HTTPS:
1. Add a DNS record: `*` → **A** → your droplet IP. Explicit records such as `www` and `api` keep working.
2. Set `SITES_DOMAIN="yourdomain.com"` in `.env`. The setup script does this for you when `DOMAIN=api.yourdomain.com`.
3. Caddy issues a certificate the first time each subdomain is visited, and only for tickers that exist (it checks `/api/sites/allowed`).


## StonkFun venue (Hypeware v2)

New coins launch on **StonkFun** (Raydium LaunchLab under StonkFun's platform) and can pair with SOL or any
launchable StonkFun quote token (tokenized stocks like NVDAx). The company treasury is the coin's creator:

- **Launch:** the creator deposits SOL. For a non-SOL pair, the dev buy is swapped to the quote token via Jupiter, then
  the pool is created and bought in one transaction. The dev-buy tokens are sent to the creator's wallet right after.
- **Fees:** every `CLAIM_EVERY_MIN` the server claims the treasury's LaunchLab creator-fee vault (and, after graduation,
  StonkFun's fee-claim intent for the locked Raydium position), swaps the quote token to SOL and keeps
  `CREATOR_FEE_SHARE_BPS` for Hypeware (paid to `PLATFORM_FEE_WALLET`, minus the flagship's share).
- **No** Meteora config, partner wallet or `meteora:claim` cron is needed.

Going live:

```bash
sudo FEE_WALLET=<your wallet> RPC=<helius mainnet url> bash deploy/go-live-stonkfun.sh
```

It finishes with `npm run stonkfun:probe`, which builds a launch transaction and **simulates** it (nothing is sent).
Run the probe again any time: `sudo -u firmware npm run stonkfun:probe` (`--quote <mint>` for a stock pair, `--raw` to
print StonkFun's raw pricing response).

**Back up `VAULT_KEY`, `.env`, `.env.local` and the database off the server.** If the server is deleted without them,
every company treasury is lost for good.
